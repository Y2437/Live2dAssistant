const {contextBridge, ipcRenderer} = require("electron");

const AGENT_STREAM_EVENT = "app:agentChatStream:event";

contextBridge.exposeInMainWorld("api", {
    ping: () => ipcRenderer.invoke("app:ping"),
    onShowView: (handler) => {
        ipcRenderer.on("ui:showView", (event, payload) => {
            handler(payload);
        });
    },
    openWindow: (windowKey) => ipcRenderer.invoke("app:openWindow", windowKey),
    chat: (message) => ipcRenderer.invoke("app:aiChat", message),
    agentChat: (message, options = {}) => ipcRenderer.invoke("app:agentChat", {
        message,
        allowedTools: Array.isArray(options?.allowedTools) ? options.allowedTools : null,
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
        ipcRenderer.on(AGENT_STREAM_EVENT, listener);
        const request = ipcRenderer.invoke("app:agentChatStream", {
            message,
            requestId,
            allowedTools: Array.isArray(options?.allowedTools) ? options.allowedTools : null,
        })
            .finally(() => {
                ipcRenderer.removeListener(AGENT_STREAM_EVENT, listener);
            });
        return request;
    },
    cancelAgentChat: (requestId) => ipcRenderer.invoke("app:agentChatCancel", {requestId}),
    getAiContextMeta: () => ipcRenderer.invoke("app:getAiContextMeta"),
    getAiContextData: () => ipcRenderer.invoke("app:getAiContextData"),
    clearAiContext: () => ipcRenderer.invoke("app:clearAiContext"),
    getLongTermMemoryData: () => ipcRenderer.invoke("app:getLongTermMemoryData"),
    getMemoryRoutineMeta: () => ipcRenderer.invoke("app:getMemoryRoutineMeta"),
    extractLongTermMemories: () => ipcRenderer.invoke("app:extractLongTermMemories"),
    deleteLongTermMemory: (memoryId) => ipcRenderer.invoke("app:deleteLongTermMemory", memoryId),
    getAgentCapabilities: () => ipcRenderer.invoke("app:getAgentCapabilities"),
    getAgentLibraryIndex: () => ipcRenderer.invoke("app:getAgentLibraryIndex"),
    searchAgentLibrary: (query) => ipcRenderer.invoke("app:searchAgentLibrary", query),
    readAgentLibraryFile: (filePath) => ipcRenderer.invoke("app:readAgentLibraryFile", filePath),
    rebuildAgentLibraryIndex: () => ipcRenderer.invoke("app:rebuildAgentLibraryIndex"),
    runAgentSelfTest: (query = "") => ipcRenderer.invoke("app:runAgentSelfTest", {query}),
    touch: (name) => ipcRenderer.invoke("app:touch", name),
    loadPomodoroJson: () => ipcRenderer.invoke("app:loadPomodoroJson"),
    savePomodoroJson: (data) => ipcRenderer.invoke("app:savePomodoroJson", data),
    loadKnowledgeCards: () => ipcRenderer.invoke("app:loadKnowledgeCards"),
    createKnowledgeCard: (data) => ipcRenderer.invoke("app:createKnowledgeCard", data),
    updateKnowledgeCard: (data) => ipcRenderer.invoke("app:updateKnowledgeCard", data),
    generateKnowledgeCardSummary: (data) => ipcRenderer.invoke("app:generateKnowledgeCardSummary", data),
    deleteKnowledgeCard: (cardId) => ipcRenderer.invoke("app:deleteKnowledgeCard", cardId),
});
