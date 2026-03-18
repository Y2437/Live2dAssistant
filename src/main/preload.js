const {contextBridge, ipcRenderer} = require("electron");

const IPC_EVENTS = {
    AGENT_STREAM: "app:agentChatStream:event",
    SHOW_VIEW: "ui:showView",
};

const IPC_CHANNELS = {
    ping: "app:ping",
    openWindow: "app:openWindow",
    chat: "app:aiChat",
    extractEmotionForLive2d: "app:extractEmotionForLive2d",
    agentChat: "app:agentChat",
    agentChatStream: "app:agentChatStream",
    cancelAgentChat: "app:agentChatCancel",
    getAiContextMeta: "app:getAiContextMeta",
    getAiContextData: "app:getAiContextData",
    clearAiContext: "app:clearAiContext",
    getLongTermMemoryData: "app:getLongTermMemoryData",
    getModelProviderSettings: "app:getModelProviderSettings",
    updateModelProviderSettings: "app:updateModelProviderSettings",
    testModelProviderPrompt: "app:testModelProviderPrompt",
    getMemoryRoutineMeta: "app:getMemoryRoutineMeta",
    extractLongTermMemories: "app:extractLongTermMemories",
    deleteLongTermMemory: "app:deleteLongTermMemory",
    getAgentCapabilities: "app:getAgentCapabilities",
    runAgentSelfTest: "app:runAgentSelfTest",
    touch: "app:touch",
    loadPomodoroJson: "app:loadPomodoroJson",
    savePomodoroJson: "app:savePomodoroJson",
    getClipboardSnapshot: "app:getClipboardSnapshot",
    getClipboardHistory: "app:getClipboardHistory",
    captureClipboard: "app:captureClipboard",
    clearClipboardHistory: "app:clearClipboardHistory",
    deleteClipboardItem: "app:deleteClipboardItem",
    pinClipboardItem: "app:pinClipboardItem",
    copyClipboardItem: "app:copyClipboardItem",
    loadKnowledgeCards: "app:loadKnowledgeCards",
    createKnowledgeCard: "app:createKnowledgeCard",
    updateKnowledgeCard: "app:updateKnowledgeCard",
    generateKnowledgeCardSummary: "app:generateKnowledgeCardSummary",
    deleteKnowledgeCard: "app:deleteKnowledgeCard",
    loadCalendarPlan: "app:loadCalendarPlan",
    getCalendarDayDetail: "app:getCalendarDayDetail",
    createCalendarTodo: "app:createCalendarTodo",
    updateCalendarTodo: "app:updateCalendarTodo",
    deleteCalendarTodo: "app:deleteCalendarTodo",
    listAiDiaries: "app:listAiDiaries",
    createAiDiary: "app:createAiDiary",
    updateAiDiary: "app:updateAiDiary",
    deleteAiDiary: "app:deleteAiDiary",
};

function createInvoker(channel) {
    return (...args) => ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld("api", {
    ping: createInvoker(IPC_CHANNELS.ping),
    onShowView: (handler) => {
        ipcRenderer.on(IPC_EVENTS.SHOW_VIEW, (event, payload) => {
            handler(payload);
        });
    },
    openWindow: createInvoker(IPC_CHANNELS.openWindow),
    chat: createInvoker(IPC_CHANNELS.chat),
    extractEmotionForLive2d: (text) => ipcRenderer.invoke(IPC_CHANNELS.extractEmotionForLive2d, {text}),
    agentChat: (message, options = {}) => ipcRenderer.invoke(IPC_CHANNELS.agentChat, {
        message,
        allowedTools: Array.isArray(options?.allowedTools) ? options.allowedTools : null,
        directMode: options?.directMode === true,
    }),
    agentChatStream: (message, handlers = {}, requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`, options = {}) => {
        const listener = (event, payload) => {
            if (!payload || payload.requestId !== requestId) {
                return;
            }
            if (payload.type === "status" && typeof handlers.onStatus === "function") {
                handlers.onStatus(payload.status);
            }
            if (payload.type === "trace" && typeof handlers.onTrace === "function") {
                handlers.onTrace(payload.trace, payload.traces || []);
            }
            if (payload.type === "content" && typeof handlers.onContent === "function") {
                handlers.onContent(payload.content || "");
            }
            if (payload.type === "error" && typeof handlers.onError === "function") {
                handlers.onError(payload.error || "Unknown stream error");
            }
            if (payload.type === "canceled" && typeof handlers.onCancel === "function") {
                handlers.onCancel(payload.error || "Request canceled.");
            }
        };
        ipcRenderer.on(IPC_EVENTS.AGENT_STREAM, listener);
        return ipcRenderer.invoke(IPC_CHANNELS.agentChatStream, {
            message,
            requestId,
            allowedTools: Array.isArray(options?.allowedTools) ? options.allowedTools : null,
            directMode: options?.directMode === true,
        }).finally(() => {
            ipcRenderer.removeListener(IPC_EVENTS.AGENT_STREAM, listener);
        });
    },
    cancelAgentChat: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.cancelAgentChat, {requestId}),
    getAiContextMeta: createInvoker(IPC_CHANNELS.getAiContextMeta),
    getAiContextData: createInvoker(IPC_CHANNELS.getAiContextData),
    clearAiContext: createInvoker(IPC_CHANNELS.clearAiContext),
    getLongTermMemoryData: createInvoker(IPC_CHANNELS.getLongTermMemoryData),
    getModelProviderSettings: createInvoker(IPC_CHANNELS.getModelProviderSettings),
    updateModelProviderSettings: createInvoker(IPC_CHANNELS.updateModelProviderSettings),
    testModelProviderPrompt: (payload = {}) => ipcRenderer.invoke(IPC_CHANNELS.testModelProviderPrompt, payload),
    getMemoryRoutineMeta: createInvoker(IPC_CHANNELS.getMemoryRoutineMeta),
    extractLongTermMemories: createInvoker(IPC_CHANNELS.extractLongTermMemories),
    deleteLongTermMemory: createInvoker(IPC_CHANNELS.deleteLongTermMemory),
    getAgentCapabilities: createInvoker(IPC_CHANNELS.getAgentCapabilities),
    runAgentSelfTest: (query = "") => ipcRenderer.invoke(IPC_CHANNELS.runAgentSelfTest, {query}),
    touch: createInvoker(IPC_CHANNELS.touch),
    loadPomodoroJson: createInvoker(IPC_CHANNELS.loadPomodoroJson),
    savePomodoroJson: createInvoker(IPC_CHANNELS.savePomodoroJson),
    getClipboardSnapshot: createInvoker(IPC_CHANNELS.getClipboardSnapshot),
    getClipboardHistory: createInvoker(IPC_CHANNELS.getClipboardHistory),
    captureClipboard: createInvoker(IPC_CHANNELS.captureClipboard),
    clearClipboardHistory: createInvoker(IPC_CHANNELS.clearClipboardHistory),
    deleteClipboardItem: createInvoker(IPC_CHANNELS.deleteClipboardItem),
    pinClipboardItem: (id, pinned = true) => ipcRenderer.invoke(IPC_CHANNELS.pinClipboardItem, {id, pinned}),
    copyClipboardItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.copyClipboardItem, id),
    loadKnowledgeCards: createInvoker(IPC_CHANNELS.loadKnowledgeCards),
    createKnowledgeCard: createInvoker(IPC_CHANNELS.createKnowledgeCard),
    updateKnowledgeCard: createInvoker(IPC_CHANNELS.updateKnowledgeCard),
    generateKnowledgeCardSummary: createInvoker(IPC_CHANNELS.generateKnowledgeCardSummary),
    deleteKnowledgeCard: createInvoker(IPC_CHANNELS.deleteKnowledgeCard),
    loadCalendarPlan: createInvoker(IPC_CHANNELS.loadCalendarPlan),
    getCalendarDayDetail: (date) => ipcRenderer.invoke(IPC_CHANNELS.getCalendarDayDetail, {date}),
    createCalendarTodo: createInvoker(IPC_CHANNELS.createCalendarTodo),
    updateCalendarTodo: createInvoker(IPC_CHANNELS.updateCalendarTodo),
    deleteCalendarTodo: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteCalendarTodo, {id}),
    listAiDiaries: createInvoker(IPC_CHANNELS.listAiDiaries),
    createAiDiary: createInvoker(IPC_CHANNELS.createAiDiary),
    updateAiDiary: createInvoker(IPC_CHANNELS.updateAiDiary),
    deleteAiDiary: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteAiDiary, {id}),
});
