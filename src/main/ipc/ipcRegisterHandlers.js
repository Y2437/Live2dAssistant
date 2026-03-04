const {ipcMain} = require("electron");

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
    ipcMain.handle("app:agentChat", async (event, message) => {
        if (typeof message !== "string" || !message.trim()) {
            throw new Error("Message is required.");
        }
        const result = await ensureAgentService(registry).chat(message.trim());
        await registry.recordAssistantExchange(message.trim(), result?.content || "");
        return result;
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
    registerCoreHandlers,
    registerAiChatHandlers,
    registerContextHandlers,
    registerAgentHandlers,
    registerPomodoroHandlers,
    registerKnowledgeCardHandlers,
};
