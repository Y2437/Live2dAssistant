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

function registerAgentHandlers(registry) {
    ipcMain.handle("app:getAgentCapabilities", async () => ensureAgentService(registry).getCapabilities());
    ipcMain.handle("app:getAgentLibraryIndex", async () => ensureAgentService(registry).getLibraryIndexData());
    ipcMain.handle("app:searchAgentLibrary", async (event, query) => ensureAgentService(registry).searchLibrary(query));
    ipcMain.handle("app:readAgentLibraryFile", async (event, filePath) => ensureAgentService(registry).readLibraryFile(filePath));
    ipcMain.handle("app:rebuildAgentLibraryIndex", async () => {
        const service = ensureAgentService(registry);
        await service.rebuildLibraryIndex();
        return service.getCapabilities();
    });
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
        if (typeof message !== "string" || !message.trim()) {
            throw new Error("Message is required.");
        }
        const result = await ensureAgentService(registry).chat(message.trim(), {}, {allowedTools, directMode});
        await registry.recordAssistantExchange(message.trim(), result?.content || "");
        return result;
    });
    ipcMain.handle("app:agentChatStream", async (event, payload) => {
        const message = typeof payload?.message === "string" ? payload.message.trim() : "";
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
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
            }, {allowedTools, directMode});
            await registry.recordAssistantExchange(message, result?.content || "");
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
    ipcMain.handle("app:savePomodoroJson", async (event, data) => {
        const fs = require("fs/promises");
        return fs.writeFile(POMODORO_JSON_PATH, JSON.stringify(data, null, 2));
    });
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
        const payload = registry.validateKnowledgeCardPayload(data, {requireId: true});
        if (!payload.id) {
            throw new Error("Card id is required.");
        }
        const card = registry.knowledgeCards.find((item) => item.id === payload.id);
        if (!card) {
            throw new Error("Card not found.");
        }
        card.title = payload.title;
        card.content = payload.content;
        card.summary = await registry.resolveKnowledgeCardSummary(payload);
        card.category = payload.category;
        card.source = payload.source;
        card.updatedAt = new Date().toISOString();
        await registry.saveKnowledgeCards();
        return {
            card,
            data: registry.getKnowledgeCardsData(),
        };
    });
    ipcMain.handle("app:deleteKnowledgeCard", async (event, cardId) => {
        if (typeof cardId !== "string" || !cardId.trim()) {
            throw new Error("Card id is required.");
        }
        const nextCards = registry.knowledgeCards.filter((item) => item.id !== cardId);
        if (nextCards.length === registry.knowledgeCards.length) {
            throw new Error("Card not found.");
        }
        registry.knowledgeCards = nextCards;
        await registry.saveKnowledgeCards();
        return registry.getKnowledgeCardsData();
    });
}

module.exports = {
    AGENT_STREAM_EVENT,
    registerCoreHandlers,
    registerAiChatHandlers,
    registerContextHandlers,
    registerAgentHandlers,
    registerPomodoroHandlers,
    registerKnowledgeCardHandlers,
};
