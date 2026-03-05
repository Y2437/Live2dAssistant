const {contextBridge, ipcRenderer} = require("electron");

const AGENT_STREAM_EVENT = "app:agentChatStream:event";
const QUICK_FLOAT_FEATURE_EVENT = "quick-float:feature-toggled";
const QUICK_FLOAT_SELECTION_READY_EVENT = "quick-float:selection-ready";
const QUICK_FLOAT_SELECTION_ERROR_EVENT = "quick-float:selection-error";

contextBridge.exposeInMainWorld("api", {
    ping: () => ipcRenderer.invoke("app:ping"),
    onShowView: (handler) => {
        ipcRenderer.on("ui:showView", (event, payload) => {
            handler(payload);
        });
    },
    onQuickFloatFeatureToggle: (handler) => {
        ipcRenderer.on(QUICK_FLOAT_FEATURE_EVENT, (event, payload) => {
            handler(payload);
        });
    },
    onQuickFloatSelectionReady: (handler) => {
        ipcRenderer.on(QUICK_FLOAT_SELECTION_READY_EVENT, (event, payload) => {
            handler(payload);
        });
    },
    onQuickFloatSelectionError: (handler) => {
        ipcRenderer.on(QUICK_FLOAT_SELECTION_ERROR_EVENT, (event, payload) => {
            handler(payload);
        });
    },
    openWindow: (windowKey) => ipcRenderer.invoke("app:openWindow", windowKey),
    chat: (message) => ipcRenderer.invoke("app:aiChat", message),
    extractEmotionForLive2d: (text) => ipcRenderer.invoke("app:extractEmotionForLive2d", {text}),
    agentChat: (message, options = {}) => ipcRenderer.invoke("app:agentChat", {
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
        ipcRenderer.on(AGENT_STREAM_EVENT, listener);
        const request = ipcRenderer.invoke("app:agentChatStream", {
            message,
            requestId,
            allowedTools: Array.isArray(options?.allowedTools) ? options.allowedTools : null,
            directMode: options?.directMode === true,
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
    runAgentSelfTest: (query = "") => ipcRenderer.invoke("app:runAgentSelfTest", {query}),
    touch: (name) => ipcRenderer.invoke("app:touch", name),
    loadPomodoroJson: () => ipcRenderer.invoke("app:loadPomodoroJson"),
    savePomodoroJson: (data) => ipcRenderer.invoke("app:savePomodoroJson", data),
    getClipboardSnapshot: () => ipcRenderer.invoke("app:getClipboardSnapshot"),
    getQuickFloatFeatureState: () => ipcRenderer.invoke("app:getQuickFloatFeatureState"),
    quickFloatCaptureSelectionText: () => ipcRenderer.invoke("app:quickFloatCaptureSelectionText"),
    quickFloatSetWindowMode: (payload = {}) => ipcRenderer.invoke("app:quickFloatSetWindowMode", payload),
    quickFloatSetInteractionState: (payload = {}) => ipcRenderer.invoke("app:quickFloatSetInteractionState", payload),
    getClipboardHistory: () => ipcRenderer.invoke("app:getClipboardHistory"),
    captureClipboard: (payload = {}) => ipcRenderer.invoke("app:captureClipboard", payload),
    clearClipboardHistory: () => ipcRenderer.invoke("app:clearClipboardHistory"),
    deleteClipboardItem: (id) => ipcRenderer.invoke("app:deleteClipboardItem", id),
    pinClipboardItem: (id, pinned = true) => ipcRenderer.invoke("app:pinClipboardItem", {id, pinned}),
    copyClipboardItem: (id) => ipcRenderer.invoke("app:copyClipboardItem", id),
    quickTranslateText: (payload = {}) => ipcRenderer.invoke("app:quickTranslateText", payload),
    quickExplainText: (payload = {}) => ipcRenderer.invoke("app:quickExplainText", payload),
    loadKnowledgeCards: () => ipcRenderer.invoke("app:loadKnowledgeCards"),
    createKnowledgeCard: (data) => ipcRenderer.invoke("app:createKnowledgeCard", data),
    updateKnowledgeCard: (data) => ipcRenderer.invoke("app:updateKnowledgeCard", data),
    generateKnowledgeCardSummary: (data) => ipcRenderer.invoke("app:generateKnowledgeCardSummary", data),
    deleteKnowledgeCard: (cardId) => ipcRenderer.invoke("app:deleteKnowledgeCard", cardId),
});
