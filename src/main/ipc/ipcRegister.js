const {ipcMain} = require('electron');
const {aiChat, aiChatWithModel} = require('./aiService.js');
const {AgentService} = require("./agentService");
const fs = require("fs/promises");
const {wm} = require("../WindowManager");
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
} = require('../config');
class ipcRegister{
    static assistantContext = [];
    static assistantLongTermMemory = [];
    static knowledgeCards = [];
    static MAX_CONTEXT_MESSAGES = 32;
    static agentService = null;
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
        if(!Array.isArray(data)){
            return [];
        }
        return data.filter((item)=>{
            return item
                && (item.role === "user" || item.role === "assistant")
                && typeof item.message === "string"
                && item.message.trim() !== "";
        }).map((item)=>({role:item.role,message:item.message}));
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
        if(!Array.isArray(data)){
            return [];
        }
        return data.filter((item)=>{
            return item
                && typeof item.title === "string"
                && item.title.trim() !== ""
                && typeof item.content === "string";
        }).map((item)=>({
            id: item.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: item.title,
            content: item.content,
            source: typeof item.source === "string" ? item.source : "manual",
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
        }));
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
        };
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
        const now = new Date().toISOString();
        const record = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title,
            content,
            source: typeof data?.source === "string" && data.source.trim() ? data.source.trim() : "agent",
            updatedAt: now,
        };
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
                    "Schema: {\"memories\":[{\"title\":\"...\",\"content\":\"...\",\"source\":\"daily-extract\"}]}",
                    "Rules:",
                    "- Keep only stable, reusable facts, preferences, projects, constraints, or long-running goals.",
                    "- Ignore one-off small talk.",
                    "- At most 6 memories.",
                    "- Each memory should be concise and deduplicated.",
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
            return {
                added: [],
                skipped: [],
                data: this.getLongTermMemoryData(),
            };
        }
        const model = process.env.AI_SUMMARY_MODEL || process.env.AI_MODEL;
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
            const duplicate = this.assistantLongTermMemory.find((memory)=>{
                return memory.title.trim().toLowerCase() === title.toLowerCase()
                    || memory.content.trim().toLowerCase() === content.toLowerCase();
            });
            if(duplicate){
                skipped.push({title, reason: "duplicate"});
                continue;
            }
            added.push(await this.addLongTermMemory({
                title,
                content,
                source: typeof item?.source === "string" && item.source.trim() ? item.source.trim() : "daily-extract",
            }));
        }
        return {
            added,
            skipped,
            data: this.getLongTermMemoryData(),
        };
    }
    static normalizeKnowledgeCards(data){
        if(!Array.isArray(data)){
            return [];
        }
        return data.filter((item)=>{
            return item
                && typeof item.title === "string"
                && item.title.trim() !== ""
                && typeof item.content === "string";
        }).map((item)=>({
            id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: item.title.trim(),
            content: item.content,
            category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : "未分类",
            source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : "user",
            createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
        }));
    }
    static async saveKnowledgeCards(){
        await fs.writeFile(KNOWLEDGE_CARDS_JSON_PATH, JSON.stringify(this.knowledgeCards, null, 2), "utf-8");
    }
    static async loadKnowledgeCards(){
        try{
            const raw = await fs.readFile(KNOWLEDGE_CARDS_JSON_PATH, "utf8");
            this.knowledgeCards = this.normalizeKnowledgeCards(JSON.parse(raw));
        }catch(err){
            if(err.code === "ENOENT"){
                this.knowledgeCards = [];
                await this.saveKnowledgeCards();
                return;
            }
            throw err;
        }
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
    static validateKnowledgeCardPayload(data, options = {}){
        const title = typeof data?.title === "string" ? data.title.trim() : "";
        const content = typeof data?.content === "string" ? data.content.trim() : "";
        if(!title){
            throw new Error("Card title is required.");
        }
        if(!content){
            throw new Error("Card content is required.");
        }
        return {
            id: options.requireId ? (typeof data?.id === "string" ? data.id.trim() : "") : "",
            title,
            content,
            summary: typeof data?.summary === "string" ? data.summary.trim() : "",
            category: typeof data?.category === "string" && data.category.trim() ? data.category.trim() : "未分类",
            source: typeof data?.source === "string" && data.source.trim() ? data.source.trim() : "user",
        };
    }
    static getAssistantReplyContent(response){
        return response?.choices?.[0]?.message?.content ?? "";
    }
    static stripMarkdownForSummary(content){
        return String(content || "")
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
            .replace(/^(#{1,6}\s+)/gm, "")
            .replace(/^>\s?/gm, "")
            .replace(/^[-*]\s+/gm, "")
            .replace(/^\d+\.\s+/gm, "")
            .replace(/[*_~]/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }
    static buildKnowledgeCardFallbackSummary(data){
        const plain = this.stripMarkdownForSummary(data?.content || "");
        if(!plain){
            return typeof data?.title === "string" ? data.title.trim() : "";
        }
        return plain.length > 84 ? `${plain.slice(0, 84).trim()}...` : plain;
    }
    static buildKnowledgeCardSummaryMessages(data){
        return [
            {
                role: "system",
                message: "你是知识卡片摘要助手。请基于标题、分类和正文，生成一条简洁客观的中文摘要。要求：1. 18到48字；2. 不使用Markdown；3. 不使用项目符号；4. 不重复标题；5. 只输出摘要正文。",
            },
            {
                role: "user",
                message: `标题：${data.title}\n分类：${data.category}\n正文：${data.content}`,
            },
        ];
    }
    static async generateKnowledgeCardSummary(data){
        const model = process.env.AI_SUMMARY_MODEL || process.env.AI_MODEL;
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
                .replace(/^["'“”]+|["'“”]+$/g, "")
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
    static registerPing(){
        ipcMain.handle('app:ping',()=>{return "pong"})
    }
    static registerOpenWindow(){
        ipcMain.handle("app:openWindow",async (event,windowKey)=>{
            if(!windowKey){
                throw new Error("Window key is missing!");
            }else if(typeof windowKey !== "string"){
                throw new Error("Window key is not a string!");
            }else if(!WINDOW_KEYS.includes(windowKey)){
                throw new Error("Invalid Window key!");
            }
            await wm.open(windowKey);
        });
    }
    static registerAiChat(){
        ipcMain.handle("app:aiChat",async (event,message)=>{
            const aiChatMessage = this.buildAiChatMessages(message);
            const response = await aiChat(aiChatMessage);
            const assistantReply = this.getAssistantReplyContent(response);

            this.assistantContext.push({role:"user",message});
            if(assistantReply){
                this.assistantContext.push({role:"assistant",message:assistantReply});
            }
            this.trimAssistantContext();
            await this.saveAssistantContext();
            return response;
        })
    }
    static registerAiContextManager(){
        ipcMain.handle("app:getAiContextMeta",async ()=>{
            return this.getAssistantContextMeta();
        });
        ipcMain.handle("app:getAiContextData",async ()=>{
            return this.getAssistantContextData();
        });
        ipcMain.handle("app:clearAiContext",async ()=>{
            this.assistantContext = [];
            await this.saveAssistantContext();
            return this.getAssistantContextMeta();
        });
        ipcMain.handle("app:getLongTermMemoryData",async ()=>{
            return this.getLongTermMemoryData();
        });
        ipcMain.handle("app:extractLongTermMemories", async ()=>{
            return await this.extractLongTermMemoriesFromContext();
        });
        ipcMain.handle("app:deleteLongTermMemory", async (event, memoryId)=>{
            return await this.deleteLongTermMemory(memoryId);
        });
    }
    static registerAgent(){
        ipcMain.handle("app:getAgentCapabilities", async ()=>{
            if(!this.agentService){
                throw new Error("Agent service is not ready.");
            }
            return this.agentService.getCapabilities();
        });
        ipcMain.handle("app:getAgentLibraryIndex", async ()=>{
            if(!this.agentService){
                throw new Error("Agent service is not ready.");
            }
            return this.agentService.getLibraryIndexData();
        });
        ipcMain.handle("app:readAgentLibraryFile", async (event, filePath)=>{
            if(!this.agentService){
                throw new Error("Agent service is not ready.");
            }
            return await this.agentService.readLibraryFile(filePath);
        });
        ipcMain.handle("app:rebuildAgentLibraryIndex", async ()=>{
            if(!this.agentService){
                throw new Error("Agent service is not ready.");
            }
            await this.agentService.rebuildLibraryIndex();
            return this.agentService.getCapabilities();
        });
        ipcMain.handle("app:agentChat", async (event, message)=>{
            if(typeof message !== "string" || !message.trim()){
                throw new Error("Message is required.");
            }
            if(!this.agentService){
                throw new Error("Agent service is not ready.");
            }
            const result = await this.agentService.chat(message.trim());

            this.assistantContext.push({role:"user", message: message.trim()});
            if(result?.content){
                this.assistantContext.push({role:"assistant", message: result.content});
            }
            this.trimAssistantContext();
            await this.saveAssistantContext();

            return result;
        });
    }
    static registerTouchResponse(){
        ipcMain.handle("app:touch",async (event,name)=>{
            const totalNum=AI_TOUCH_RESPONSE[name].response.length;
            const selectedNum=Math.floor(Math.random() * (totalNum));
            return AI_TOUCH_RESPONSE[name].response[selectedNum].content;
        })
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
        ipcMain.handle("app:loadPomodoroJson",async (event)=>{
            return await this.ensurePomodoroJson(POMODORO_JSON_PATH);
        })
        ipcMain.handle("app:savePomodoroJson",async (event,data)=>{
            return await fs.writeFile(POMODORO_JSON_PATH,JSON.stringify(data,null,2));
        })
    }
    static registerKnowledgeCards(){
        ipcMain.handle("app:loadKnowledgeCards", async ()=>{
            return this.getKnowledgeCardsData();
        });
        ipcMain.handle("app:generateKnowledgeCardSummary", async (event, data)=>{
            const payload = this.validateKnowledgeCardPayload(data);
            return {
                summary: await this.generateKnowledgeCardSummary(payload),
            };
        });
        ipcMain.handle("app:createKnowledgeCard", async (event, data)=>{
            const payload = this.validateKnowledgeCardPayload(data);
            const now = new Date().toISOString();
            const summary = await this.generateKnowledgeCardSummary(payload);
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
            return {
                card,
                data: this.getKnowledgeCardsData(),
            };
        });
        ipcMain.handle("app:updateKnowledgeCard", async (event, data)=>{
            const payload = this.validateKnowledgeCardPayload(data, {requireId: true});
            if(!payload.id){
                throw new Error("Card id is required.");
            }
            const card = this.knowledgeCards.find((item)=>item.id === payload.id);
            if(!card){
                throw new Error("Card not found.");
            }
            card.title = payload.title;
            card.content = payload.content;
            card.summary = await this.generateKnowledgeCardSummary(payload);
            card.category = payload.category;
            card.source = payload.source;
            card.updatedAt = new Date().toISOString();
            await this.saveKnowledgeCards();
            return {
                card,
                data: this.getKnowledgeCardsData(),
            };
        });
        ipcMain.handle("app:deleteKnowledgeCard", async (event, cardId)=>{
            if(typeof cardId !== "string" || !cardId.trim()){
                throw new Error("Card id is required.");
            }
            const nextCards = this.knowledgeCards.filter((item)=>item.id !== cardId);
            if(nextCards.length === this.knowledgeCards.length){
                throw new Error("Card not found.");
            }
            this.knowledgeCards = nextCards;
            await this.saveKnowledgeCards();
            return this.getKnowledgeCardsData();
        });
    }

    static async registerAll(){
        await this.loadAssistantContext();
        await this.loadLongTermMemory();
        await this.loadKnowledgeCards();
        this.agentService = new AgentService({
            getAssistantContext: ()=>[...this.assistantContext],
            getLongTermMemory: ()=>[...this.assistantLongTermMemory],
            addLongTermMemory: async (data)=>await this.addLongTermMemory(data),
            deleteLongTermMemory: async (memoryId)=>await this.deleteLongTermMemory(memoryId),
            extractLongTermMemories: async ()=>await this.extractLongTermMemoriesFromContext(),
            getKnowledgeCards: ()=>[...this.knowledgeCards],
            createKnowledgeCard: async (data)=>{
                const payload = this.validateKnowledgeCardPayload(data);
                const now = new Date().toISOString();
                const summary = await this.generateKnowledgeCardSummary(payload);
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
            },
            getPomodoroData: async ()=>await this.ensurePomodoroJson(POMODORO_JSON_PATH),
        });
        await this.agentService.ensureReady();
        this.registerOpenWindow();
        this.registerPing();
        this.registerAiChat();
        this.registerAiContextManager();
        this.registerAgent();
        this.registerTouchResponse();
        this.registerPomodoroJson();
        this.registerKnowledgeCards();
    }

}
module.exports = {ipcRegister};
