const {ipcMain} = require('electron');
const {aiChat, aiChatWithModel} = require('./aiService.js');
const {AgentService} = require("./agentService");
const {
    normalizeAssistantContext,
    normalizeLongTermMemory,
    normalizeMemoryCategory,
    normalizeMemoryTags,
    normalizeMemoryConfidence,
    normalizeMemoryStatus,
    buildMemoryFingerprint,
    isMemoryNoise,
    normalizeMemoryRoutineMeta,
    stripMarkdownForSummary,
    buildKnowledgeCardFallbackSummary,
    validateKnowledgeCardPayload,
    normalizeKnowledgeCards,
    buildKnowledgeCardSummaryMessages,
} = require("./ipcDataUtils");
const {
    registerCoreHandlers,
    registerAiChatHandlers,
    registerContextHandlers,
    registerAgentHandlers,
    registerPomodoroHandlers,
    registerKnowledgeCardHandlers,
} = require("./ipcRegisterHandlers");
const fs = require("fs/promises");
const {wm} = require("../window/WindowManager");
const {
    WIDTH,
    HEIGHT,
    WINDOW_KEYS,
    AI_CHAT_SYSTEM_PROMPT,
    AI_TOUCH_RESPONSE,
    POMODORO_JSON_PATH,
    AI_CONTEXT_JSON_PATH,
    AI_LONG_TERM_MEMORY_JSON_PATH,
    KNOWLEDGE_CARDS_JSON_PATH,
    AI_MEMORY_ROUTINE_JSON_PATH,
    ENV_CONFIG,
} = require('../config');
// Main-process IPC orchestration for chat, memory, cards, and agent wiring.
class ipcRegister{
    static assistantContext = [];
    static assistantLongTermMemory = [];
    static knowledgeCards = [];
    static MAX_CONTEXT_MESSAGES = 32;
    static agentService = null;
    static memoryRoutineMeta = {
        lastExtractionDate: "",
        lastRunAt: "",
        lastStatus: "idle",
        lastAddedCount: 0,
        lastSkippedCount: 0,
        lastError: "",
    };
    constructor(ipc){
    }
    static buildAiChatMessages(message){
        return [
            {role:"system",message:AI_CHAT_SYSTEM_PROMPT},
            ...this.assistantContext,
            {role:"user",message},
        ];
    }
    static trimAssistantContext(){
        if(this.assistantContext.length <= this.MAX_CONTEXT_MESSAGES){
            return;
        }
        this.assistantContext = this.assistantContext.slice(-this.MAX_CONTEXT_MESSAGES);
    }
    static normalizeAssistantContext(data){
        return normalizeAssistantContext(data);
    }
    static async saveAssistantContext(){
        await fs.writeFile(AI_CONTEXT_JSON_PATH, JSON.stringify(this.assistantContext, null, 2), "utf-8");
    }
    static async loadAssistantContext(){
        try{
            const raw = await fs.readFile(AI_CONTEXT_JSON_PATH, "utf8");
            this.assistantContext = this.normalizeAssistantContext(JSON.parse(raw));
            this.trimAssistantContext();
        }catch(err){
            if(err.code === "ENOENT"){
                this.assistantContext = [];
                await this.saveAssistantContext();
                return;
            }
            throw err;
        }
    }
    static normalizeLongTermMemory(data){
        return normalizeLongTermMemory(data);
    }
    static normalizeMemoryCategory(value, title = "", content = ""){
        return normalizeMemoryCategory(value, title, content);
    }
    static normalizeMemoryTags(value, title = "", content = ""){
        return normalizeMemoryTags(value, title, content);
    }
    static normalizeMemoryConfidence(value){
        return normalizeMemoryConfidence(value);
    }
    static normalizeMemoryStatus(value){
        return normalizeMemoryStatus(value);
    }
    static buildMemoryFingerprint(title, content){
        return buildMemoryFingerprint(title, content);
    }
    static isMemoryNoise(title, content){
        return isMemoryNoise(title, content);
    }
    static findDuplicateMemoryIndex(title, content){
        const fingerprint = this.buildMemoryFingerprint(title, content);
        return this.assistantLongTermMemory.findIndex((item)=>{
            if(item.fingerprint === fingerprint){
                return true;
            }
            const titleValue = item.title.trim().toLowerCase();
            const contentValue = item.content.trim().toLowerCase();
            return titleValue === title.trim().toLowerCase()
                || contentValue === content.trim().toLowerCase()
                || contentValue.includes(content.trim().toLowerCase())
                || content.trim().toLowerCase().includes(contentValue);
        });
    }
    static buildLongTermMemoryStats(items = this.assistantLongTermMemory){
        const categoryCounts = {};
        let activeCount = 0;
        for(const item of items){
            categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
            if(item.status !== "archived"){
                activeCount += 1;
            }
        }
        return {
            totalCount: items.length,
            activeCount,
            categoryCounts,
        };
    }
    static async saveLongTermMemory(){
        await fs.writeFile(AI_LONG_TERM_MEMORY_JSON_PATH, JSON.stringify(this.assistantLongTermMemory, null, 2), "utf-8");
    }
    static async loadLongTermMemory(){
        try{
            const raw = await fs.readFile(AI_LONG_TERM_MEMORY_JSON_PATH, "utf8");
            this.assistantLongTermMemory = this.normalizeLongTermMemory(JSON.parse(raw));
        }catch(err){
            if(err.code === "ENOENT"){
                this.assistantLongTermMemory = [];
                await this.saveLongTermMemory();
                return;
            }
            throw err;
        }
    }
    static getAssistantContextMeta(){
        return {
            messageCount: this.assistantContext.length,
        };
    }
    static getAssistantContextData(){
        return {
            messageCount: this.assistantContext.length,
            items: this.assistantContext,
        };
    }
    static getLongTermMemoryData(){
        return {
            memoryCount: this.assistantLongTermMemory.length,
            items: this.assistantLongTermMemory,
            stats: this.buildLongTermMemoryStats(),
        };
    }
    static normalizeMemoryRoutineMeta(data){
        return normalizeMemoryRoutineMeta(this.memoryRoutineMeta, data);
    }
    static async saveMemoryRoutineMeta(){
        await fs.writeFile(AI_MEMORY_ROUTINE_JSON_PATH, JSON.stringify(this.memoryRoutineMeta, null, 2), "utf-8");
    }
    static async loadMemoryRoutineMeta(){
        try{
            const raw = await fs.readFile(AI_MEMORY_ROUTINE_JSON_PATH, "utf8");
            this.memoryRoutineMeta = this.normalizeMemoryRoutineMeta(JSON.parse(raw));
        }catch(err){
            if(err.code === "ENOENT"){
                this.memoryRoutineMeta = this.normalizeMemoryRoutineMeta({});
                await this.saveMemoryRoutineMeta();
                return;
            }
            throw err;
        }
    }
    static getMemoryRoutineMeta(){
        return {...this.memoryRoutineMeta};
    }
    static async addLongTermMemory(data){
        const title = typeof data?.title === "string" ? data.title.trim() : "";
        const content = typeof data?.content === "string" ? data.content.trim() : "";
        if(!title){
            throw new Error("Memory title is required.");
        }
        if(!content){
            throw new Error("Memory content is required.");
        }
        if(this.isMemoryNoise(title, content)){
            throw new Error("Memory content is too noisy to store.");
        }
        const now = new Date().toISOString();
        const record = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title,
            content,
            source: typeof data?.source === "string" && data.source.trim() ? data.source.trim() : "agent",
            category: this.normalizeMemoryCategory(data?.category, title, content),
            tags: this.normalizeMemoryTags(data?.tags, title, content),
            confidence: this.normalizeMemoryConfidence(data?.confidence),
            status: this.normalizeMemoryStatus(data?.status),
            fingerprint: this.buildMemoryFingerprint(title, content),
            updatedAt: now,
        };
        const duplicateIndex = this.findDuplicateMemoryIndex(title, content);
        if(duplicateIndex !== -1){
            const existing = this.assistantLongTermMemory[duplicateIndex];
            this.assistantLongTermMemory[duplicateIndex] = {
                ...existing,
                ...record,
                id: existing.id,
                createdAt: existing.createdAt || now,
                updatedAt: now,
                source: existing.source || record.source,
                status: existing.status === "archived" ? "active" : record.status,
                confidence: Math.max(existing.confidence || 0, record.confidence || 0),
                tags: Array.from(new Set([...(existing.tags || []), ...(record.tags || [])])).slice(0, 8),
            };
            const merged = this.assistantLongTermMemory.splice(duplicateIndex, 1)[0];
            this.assistantLongTermMemory.unshift(merged);
            await this.saveLongTermMemory();
            return merged;
        }
        record.createdAt = now;
        this.assistantLongTermMemory.unshift(record);
        await this.saveLongTermMemory();
        return record;
    }
    static async deleteLongTermMemory(memoryId){
        if(typeof memoryId !== "string" || !memoryId.trim()){
            throw new Error("Memory id is required.");
        }
        const nextItems = this.assistantLongTermMemory.filter((item)=>item.id !== memoryId);
        if(nextItems.length === this.assistantLongTermMemory.length){
            throw new Error("Memory not found.");
        }
        this.assistantLongTermMemory = nextItems;
        await this.saveLongTermMemory();
        return this.getLongTermMemoryData();
    }
    static buildMemoryExtractionMessages(contextItems){
        return [
            {
                role: "system",
                message: [
                    "You extract durable user memory from chat history.",
                    "Return valid JSON only.",
                    "Schema: {\"memories\":[{\"title\":\"...\",\"content\":\"...\",\"source\":\"daily-extract\",\"category\":\"project\",\"tags\":[\"tag\"],\"confidence\":0.82}]}",
                    "Rules:",
                    "- Keep only stable, reusable facts, preferences, projects, constraints, or long-running goals.",
                    "- Ignore one-off small talk.",
                    "- At most 6 memories.",
                    "- Each memory should be concise and deduplicated.",
                    "- Add category from: identity, preference, project, constraint, plan, relationship, workflow, reference, other.",
                    "- Add tags as short lowercase keywords.",
                    "- Add confidence from 0 to 1.",
                ].join("\n"),
            },
            {
                role: "user",
                message: contextItems.map((item, index)=>`${index + 1}. ${item.role}: ${item.message}`).join("\n"),
            },
        ];
    }
    static parseJsonObject(text){
        const value = String(text || "").trim();
        try{
            return JSON.parse(value);
        }catch(err){
            const match = value.match(/```json\s*([\s\S]*?)```/i) || value.match(/```([\s\S]*?)```/);
            if(match){
                try{
                    return JSON.parse(match[1].trim());
                }catch(innerErr){
                    return null;
                }
            }
            const start = value.indexOf("{");
            const end = value.lastIndexOf("}");
            if(start !== -1 && end > start){
                try{
                    return JSON.parse(value.slice(start, end + 1));
                }catch(innerErr){
                    return null;
                }
            }
            return null;
        }
    }
    static async extractLongTermMemoriesFromContext(){
        const contextItems = this.assistantContext.slice(-16);
        if(!contextItems.length){
            this.memoryRoutineMeta = {
                ...this.memoryRoutineMeta,
                lastRunAt: new Date().toISOString(),
                lastStatus: "idle",
                lastError: "",
                lastAddedCount: 0,
                lastSkippedCount: 0,
            };
            await this.saveMemoryRoutineMeta();
            return {
                added: [],
                skipped: [],
                data: this.getLongTermMemoryData(),
                meta: this.getMemoryRoutineMeta(),
            };
        }
        const model = ENV_CONFIG.AI_SUMMARY_MODEL || ENV_CONFIG.AI_MODEL;
        if(!model){
            throw new Error("Missing memory extraction model configuration.");
        }
        const response = await aiChatWithModel(this.buildMemoryExtractionMessages(contextItems), {
            model,
            temperature: 0.2,
            maxTokens: 512,
        });
        const raw = this.getAssistantReplyContent(response);
        const parsed = this.parseJsonObject(raw);
        const items = Array.isArray(parsed?.memories) ? parsed.memories : [];
        const added = [];
        const skipped = [];
        for(const item of items){
            const title = typeof item?.title === "string" ? item.title.trim() : "";
            const content = typeof item?.content === "string" ? item.content.trim() : "";
            if(!title || !content){
                continue;
            }
            if(this.isMemoryNoise(title, content)){
                skipped.push({title, reason: "noise"});
                continue;
            }
            if(this.findDuplicateMemoryIndex(title, content) !== -1){
                skipped.push({title, reason: "duplicate"});
                continue;
            }
            added.push(await this.addLongTermMemory({
                title,
                content,
                source: typeof item?.source === "string" && item.source.trim() ? item.source.trim() : "daily-extract",
                category: item?.category,
                tags: item?.tags,
                confidence: item?.confidence,
            }));
        }
        this.memoryRoutineMeta = {
            ...this.memoryRoutineMeta,
            lastExtractionDate: new Date().toISOString().slice(0, 10),
            lastRunAt: new Date().toISOString(),
            lastStatus: "success",
            lastAddedCount: added.length,
            lastSkippedCount: skipped.length,
            lastError: "",
        };
        await this.saveMemoryRoutineMeta();
        return {
            added,
            skipped,
            data: this.getLongTermMemoryData(),
            meta: this.getMemoryRoutineMeta(),
        };
    }
    static async maybeRunDailyMemoryExtraction(){
        const today = new Date().toISOString().slice(0, 10);
        if(this.memoryRoutineMeta.lastExtractionDate === today){
            return this.getMemoryRoutineMeta();
        }
        try{
            await this.extractLongTermMemoriesFromContext();
        }catch(err){
            this.memoryRoutineMeta = {
                ...this.memoryRoutineMeta,
                lastExtractionDate: today,
                lastRunAt: new Date().toISOString(),
                lastStatus: "error",
                lastError: err?.message || String(err),
            };
            await this.saveMemoryRoutineMeta();
            console.warn("[memory-routine] daily extraction failed:", err?.message || err);
        }
        return this.getMemoryRoutineMeta();
    }
    static getKnowledgeCardsData(){
        return {
            cardCount: this.knowledgeCards.length,
            categories: Array.from(new Set(this.knowledgeCards.map((item)=>item.category))).sort((a, b)=>a.localeCompare(b, "zh-CN")),
            items: [...this.knowledgeCards]
                .sort((a, b)=>{
                    return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt), "zh-CN");
                })
                .map((item)=>({
                    ...item,
                    summary: typeof item.summary === "string" && item.summary.trim()
                        ? item.summary.trim()
                        : this.buildKnowledgeCardFallbackSummary(item),
                })),
        };
    }
    static async saveKnowledgeCards(){
        await fs.writeFile(KNOWLEDGE_CARDS_JSON_PATH, JSON.stringify(this.knowledgeCards, null, 2), "utf-8");
    }
    static validateKnowledgeCardPayload(data, options = {}){
        return validateKnowledgeCardPayload(data, options);
    }
    static getAssistantReplyContent(response){
        return response?.choices?.[0]?.message?.content ?? "";
    }
    static async recordAssistantExchange(userMessage, assistantMessage){
        this.assistantContext.push({role: "user", message: userMessage});
        if(assistantMessage){
            this.assistantContext.push({role: "assistant", message: assistantMessage});
        }
        this.trimAssistantContext();
        await this.saveAssistantContext();
    }
    static async runAiChat(message){
        const aiChatMessage = this.buildAiChatMessages(message);
        const response = await aiChat(aiChatMessage);
        const assistantReply = this.getAssistantReplyContent(response);
        await this.recordAssistantExchange(message, assistantReply);
        return response;
    }
    static stripMarkdownForSummary(content){
        return stripMarkdownForSummary(content);
    }
    static buildKnowledgeCardFallbackSummary(data){
        return buildKnowledgeCardFallbackSummary(data);
    }
    static buildKnowledgeCardSummaryMessages(data){
        return buildKnowledgeCardSummaryMessages(data);
    }
    static async generateKnowledgeCardSummary(data){
        const model = ENV_CONFIG.AI_SUMMARY_MODEL || ENV_CONFIG.AI_MODEL;
        if(!model){
            console.log("[cards-summary] fallback summary model missing");
            return this.buildKnowledgeCardFallbackSummary(data);
        }
        try{
            console.log("[cards-summary] request", {
                model,
                title: data?.title || "",
                category: data?.category || "",
            });
            const response = await aiChatWithModel(this.buildKnowledgeCardSummaryMessages(data), {
                model,
                temperature: 0.2,
                maxTokens: 96,
            });
            const summary = this.getAssistantReplyContent(response)
                .replace(/\s+/g, " ")
                .replace(/^["']+|["']+$/g, "")
                .trim();
            if(summary){
                console.log("[cards-summary] success", {model, summary});
                return summary.length > 84 ? `${summary.slice(0, 84).trim()}...` : summary;
            }
        }catch(err){
            console.warn("Knowledge card summary generation failed:", err?.message || err);
        }
        console.log("[cards-summary] fallback", {
            model,
            summary: this.buildKnowledgeCardFallbackSummary(data),
        });
        return this.buildKnowledgeCardFallbackSummary(data);
    }
    static normalizeKnowledgeCards(data){
        return normalizeKnowledgeCards(data);
    }
    static async loadKnowledgeCards(){
        try{
            const raw = await fs.readFile(KNOWLEDGE_CARDS_JSON_PATH, "utf8");
            const parsed = JSON.parse(raw);
            this.knowledgeCards = this.normalizeKnowledgeCards(parsed);
            if(JSON.stringify(parsed) !== JSON.stringify(this.knowledgeCards)){
                await this.saveKnowledgeCards();
            }
        }catch(err){
            if(err.code === "ENOENT"){
                this.knowledgeCards = [];
                await this.saveKnowledgeCards();
                return;
            }
            throw err;
        }
    }
    static async resolveKnowledgeCardSummary(data){
        if(typeof data?.summary === "string" && data.summary.trim()){
            return data.summary.trim();
        }
        return await this.generateKnowledgeCardSummary(data);
    }
    static async createKnowledgeCardRecord(data){
        const payload = this.validateKnowledgeCardPayload(data);
        const now = new Date().toISOString();
        const summary = await this.resolveKnowledgeCardSummary(payload);
        const card = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: payload.title,
            content: payload.content,
            summary,
            category: payload.category,
            source: payload.source,
            createdAt: now,
            updatedAt: now,
        };
        this.knowledgeCards.push(card);
        await this.saveKnowledgeCards();
        return card;
    }
    static registerPing(){
        // Core one-off handlers are grouped here to avoid scattering tiny IPC registrations.
        registerCoreHandlers(this, {wm, WINDOW_KEYS, AI_TOUCH_RESPONSE});
    }
    static registerAiChat(){
        registerAiChatHandlers(this);
    }
    static registerAiContextManager(){
        registerContextHandlers(this);
    }
    static registerAgent(){
        registerAgentHandlers(this);
    }
    static async ensurePomodoroJsonExists(dataPath){
        return JSON.parse(await fs.readFile(dataPath,"utf8"));
    }
    static async ensurePomodoroJson(dataPath){
        try{
            return await this.ensurePomodoroJsonExists(dataPath);
        }catch(err){
            if(err.code === "ENOENT"){
                await fs.writeFile(dataPath,"[]","utf-8");
                return [];
            }else throw err;
        }

    }

    // app.whenReady().then(() => {
    //     path = require("path");
    //     dataPath=path.join(app.getPath("userData"),"todo.json");
    //     mainWindow= createWindow({width: WIDTH, height: HEIGHT});
    //     mainWindow.loadFile(path.join(__dirname, "index.html"));
    //     mainWindow.webContents.openDevTools();
    //
    //
    //     ipcMain.handle("todo:save",async (event,data)=>{
    //         let saveData = JSON.stringify(data, null, 2);
    //         return fs.writeFile(dataPath,saveData);
    //     });
    //     ipcMain.handle("todo:load",async (event)=>{
    //         return await ensureTodoFile(dataPath);
    //     })
    //
    // })
    static registerPomodoroJson(){
        registerPomodoroHandlers(this, {POMODORO_JSON_PATH});
    }
    static registerKnowledgeCards(){
        registerKnowledgeCardHandlers(this);
    }

    static async registerAll(){
        await this.loadAssistantContext();
        await this.loadLongTermMemory();
        await this.loadKnowledgeCards();
        await this.loadMemoryRoutineMeta();
        this.agentService = new AgentService({
            getAssistantContext: ()=>[...this.assistantContext],
            getLongTermMemory: ()=>[...this.assistantLongTermMemory],
            addLongTermMemory: async (data)=>await this.addLongTermMemory(data),
            deleteLongTermMemory: async (memoryId)=>await this.deleteLongTermMemory(memoryId),
            extractLongTermMemories: async ()=>await this.extractLongTermMemoriesFromContext(),
            getMemoryRoutineMeta: ()=>this.getMemoryRoutineMeta(),
            getKnowledgeCards: ()=>[...this.knowledgeCards],
            createKnowledgeCard: async (data)=>await this.createKnowledgeCardRecord(data),
            getPomodoroData: async ()=>await this.ensurePomodoroJson(POMODORO_JSON_PATH),
        });
        await this.agentService.ensureReady();
        await this.maybeRunDailyMemoryExtraction();
        this.registerPing();
        this.registerAiChat();
        this.registerAiContextManager();
        this.registerAgent();
        this.registerPomodoroJson();
        this.registerKnowledgeCards();
    }

}
module.exports = {ipcRegister};
