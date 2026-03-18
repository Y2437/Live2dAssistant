const {ipcMain} = require("electron");
const AGENT_STREAM_EVENT = "app:agentChatStream:event";
const activeAgentStreams = new Map();

// Grouped IPC registration helpers keep ipcRegister focused on state and lifecycle.

function ensureAgentService(registry) {
    if (!registry.agentService) {
        throw new Error("Agent service is not ready.");
    }
    return registry.agentService;
}

function resolveRunId(value = "") {
    const runId = String(value || "").trim();
    return runId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function registerCoreHandlers(registry, {wm, WINDOW_KEYS, AI_TOUCH_RESPONSE}) {
    ipcMain.handle("app:ping", () => "pong");

    ipcMain.handle("app:openWindow", async (event, windowKey) => {
        if (!windowKey) {
            throw new Error("Window key is missing!");
        }
        if (typeof windowKey !== "string") {
            throw new Error("Window key is not a string!");
        }
        if (!WINDOW_KEYS.includes(windowKey)) {
            throw new Error("Invalid Window key!");
        }
        await wm.open(windowKey);
    });

    ipcMain.handle("app:touch", async (event, name) => {
        const responses = AI_TOUCH_RESPONSE[name]?.response || [];
        if (!responses.length) {
            throw new Error(`Unknown touch target: ${name}`);
        }
        const selectedIndex = Math.floor(Math.random() * responses.length);
        return responses[selectedIndex].content;
    });
}

function registerAiChatHandlers(registry) {
    ipcMain.handle("app:aiChat", async (event, message) => registry.runAiChat(message));
}

function registerEmotionHandlers(registry) {
    ipcMain.handle("app:extractEmotionForLive2d", async (event, payload) => {
        const text = typeof payload?.text === "string" ? payload.text : "";
        console.log("[emotion-ipc] request", {textLength: text.length});
        const result = await registry.extractEmotionForLive2d(text);
        console.log("[emotion-ipc] response", result);
        return result;
    });
}

function registerContextHandlers(registry) {
    ipcMain.handle("app:getAiContextMeta", async () => registry.getAssistantContextMeta());
    ipcMain.handle("app:getAiContextData", async () => registry.getAssistantContextData());
    ipcMain.handle("app:clearAiContext", async () => {
        registry.assistantContext = [];
        await registry.saveAssistantContext();
        return registry.getAssistantContextMeta();
    });
    ipcMain.handle("app:getLongTermMemoryData", async () => registry.getLongTermMemoryData());
    ipcMain.handle("app:getMemoryRoutineMeta", async () => registry.getMemoryRoutineMeta());
    ipcMain.handle("app:extractLongTermMemories", async () => registry.extractLongTermMemoriesFromContext());
    ipcMain.handle("app:deleteLongTermMemory", async (event, memoryId) => registry.deleteLongTermMemory(memoryId));
}

function registerModelProviderHandlers(registry) {
    ipcMain.handle("app:getModelProviderSettings", async () => registry.getModelProviderSettingsData());
    ipcMain.handle("app:updateModelProviderSettings", async (event, payload) => registry.updateModelProviderSettings(payload || {}));
    ipcMain.handle("app:testModelProviderPrompt", async (event, payload) => registry.testModelProviderPrompt(payload || {}));
}

function registerAgentHandlers(registry) {
    ipcMain.handle("app:getAgentCapabilities", async () => ensureAgentService(registry).getCapabilities());
    ipcMain.handle("app:runAgentSelfTest", async (event, payload) => {
        const query = typeof payload?.query === "string" ? payload.query.trim() : "";
        return ensureAgentService(registry).runCapabilitySelfTest(query);
    });
    ipcMain.handle("app:agentChat", async (event, payload) => {
        const message = typeof payload === "string"
            ? payload
            : payload?.message;
        const allowedTools = Array.isArray(payload?.allowedTools) ? payload.allowedTools : null;
        const directMode = payload?.directMode === true;
        const runId = resolveRunId(payload?.runId);
        if (typeof message !== "string" || !message.trim()) {
            throw new Error("Message is required.");
        }
        const result = await ensureAgentService(registry).chat(message.trim(), {}, {allowedTools, directMode, runId});
        await registry.recordAssistantExchange(message.trim(), result?.content || "", {
            mode: "agent",
            directMode,
            run: result?.run || {
                runId,
                directMode,
                status: "success",
                traces: Array.isArray(result?.traces) ? result.traces : [],
                callChain: Array.isArray(result?.callChain) ? result.callChain : [],
            },
        });
        return result;
    });
    ipcMain.handle("app:agentChatStream", async (event, payload) => {
        const message = typeof payload?.message === "string" ? payload.message.trim() : "";
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        const runId = resolveRunId(payload?.runId || requestId);
        if (!message) {
            throw new Error("Message is required.");
        }
        if (!requestId) {
            throw new Error("Request id is required.");
        }
        const send = (data) => {
            event.sender.send(AGENT_STREAM_EVENT, {
                requestId,
                ...data,
            });
        };
        const abortController = new AbortController();
        activeAgentStreams.set(requestId, abortController);
        try {
            const allowedTools = Array.isArray(payload?.allowedTools) ? payload.allowedTools : null;
            const directMode = payload?.directMode === true;
            const result = await ensureAgentService(registry).chat(message, {
                onStatus: directMode ? null : async (status) => send({type: "status", status}),
                onTrace: directMode ? null : async (trace, traces) => send({type: "trace", trace, traces}),
                onText: async (content) => send({type: "content", content}),
                signal: abortController.signal,
            }, {allowedTools, directMode, runId});
            await registry.recordAssistantExchange(message, result?.content || "", {
                mode: "agent",
                directMode,
                run: result?.run || {
                    runId,
                    directMode,
                    status: "success",
                    traces: Array.isArray(result?.traces) ? result.traces : [],
                    callChain: Array.isArray(result?.callChain) ? result.callChain : [],
                },
            });
            send({type: "complete", result});
            return result;
        } catch (error) {
            if (error?.name === "AbortError") {
                send({
                    type: "canceled",
                    error: error?.message || "Request canceled.",
                });
                throw error;
            }
            send({
                type: "error",
                error: error?.message || String(error),
            });
            throw error;
        } finally {
            activeAgentStreams.delete(requestId);
        }
    });
    ipcMain.handle("app:agentChatCancel", async (event, payload) => {
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        if (!requestId) {
            throw new Error("Request id is required.");
        }
        const controller = activeAgentStreams.get(requestId);
        if (!controller) {
            return {ok: false, requestId};
        }
        controller.abort();
        return {ok: true, requestId};
    });
}

function registerPomodoroHandlers(registry, {POMODORO_JSON_PATH}) {
    ipcMain.handle("app:loadPomodoroJson", async () => registry.ensurePomodoroJson(POMODORO_JSON_PATH));
    ipcMain.handle("app:savePomodoroJson", async (event, data) => registry.savePomodoroTaskList(data));
}

function registerClipboardHandlers(registry) {
    ipcMain.handle("app:getClipboardSnapshot", async () => registry.getClipboardSnapshotData());
    ipcMain.handle("app:getClipboardHistory", async () => registry.getClipboardHistoryData());
    ipcMain.handle("app:captureClipboard", async (event, payload) => {
        const source = typeof payload?.source === "string" ? payload.source : "manual";
        return registry.captureClipboardRecord({source});
    });
    ipcMain.handle("app:clearClipboardHistory", async () => registry.clearClipboardHistory());
    ipcMain.handle("app:deleteClipboardItem", async (event, id) => registry.deleteClipboardItem(id));
    ipcMain.handle("app:pinClipboardItem", async (event, payload) => {
        const id = typeof payload?.id === "string" ? payload.id : "";
        const pinned = payload?.pinned !== false;
        return registry.pinClipboardItem(id, pinned);
    });
    ipcMain.handle("app:copyClipboardItem", async (event, id) => registry.copyClipboardItem(id));
}

function registerKnowledgeCardHandlers(registry) {
    ipcMain.handle("app:loadKnowledgeCards", async () => registry.getKnowledgeCardsData());
    ipcMain.handle("app:generateKnowledgeCardSummary", async (event, data) => {
        const payload = registry.validateKnowledgeCardPayload(data);
        return {
            summary: await registry.generateKnowledgeCardSummary(payload),
        };
    });
    ipcMain.handle("app:createKnowledgeCard", async (event, data) => {
        const card = await registry.createKnowledgeCardRecord(data);
        return {
            card,
            data: registry.getKnowledgeCardsData(),
        };
    });
    ipcMain.handle("app:updateKnowledgeCard", async (event, data) => {
        const card = await registry.updateKnowledgeCardRecord(data);
        return {
            card,
            data: registry.getKnowledgeCardsData(),
        };
    });
    ipcMain.handle("app:deleteKnowledgeCard", async (event, cardId) => registry.deleteKnowledgeCardRecord(cardId));
}

function registerCalendarHandlers(registry) {
    ipcMain.handle("app:loadCalendarPlan", async () => registry.getCalendarPlanData());
    ipcMain.handle("app:getCalendarDayDetail", async (event, payload) => {
        const date = typeof payload?.date === "string" ? payload.date : "";
        return registry.getCalendarDayDetail(date);
    });
    ipcMain.handle("app:createCalendarTodo", async (event, payload) => registry.createCalendarTodo(payload));
    ipcMain.handle("app:updateCalendarTodo", async (event, payload) => registry.updateCalendarTodo(payload));
    ipcMain.handle("app:deleteCalendarTodo", async (event, payload) => {
        const id = typeof payload?.id === "string" ? payload.id : payload;
        return registry.deleteCalendarTodo(id);
    });
    ipcMain.handle("app:listAiDiaries", async (event, payload) => registry.listAiDiaries(payload || {}));
    ipcMain.handle("app:createAiDiary", async (event, payload) => registry.createAiDiary(payload));
    ipcMain.handle("app:updateAiDiary", async (event, payload) => registry.updateAiDiary(payload));
    ipcMain.handle("app:deleteAiDiary", async (event, payload) => {
        const id = typeof payload?.id === "string" ? payload.id : payload;
        return registry.deleteAiDiary(id);
    });
}

module.exports = {
    AGENT_STREAM_EVENT,
    registerCoreHandlers,
    registerAiChatHandlers,
    registerEmotionHandlers,
    registerContextHandlers,
    registerModelProviderHandlers,
    registerAgentHandlers,
    registerPomodoroHandlers,
    registerClipboardHandlers,
    registerKnowledgeCardHandlers,
    registerCalendarHandlers,
};
