const {clipboard, nativeImage} = require("electron");
const {aiChat, aiChatWithModel} = require('./aiService.js');
const {AgentService} = require("./agentService");
const {buildAssistantChatMessages} = require("./assistantPrompt");
const {
    buildKnowledgeCardSummaryMessages: buildKnowledgeCardSummaryPromptMessages,
    buildMemoryExtractionMessages: buildMemoryExtractionPromptMessages,
    buildAiDiaryWriterMessages: buildAiDiaryWriterPromptMessages,
} = require("./promptRegistry");
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
} = require("./ipcDataUtils");
const {
    registerCoreHandlers,
    registerAiChatHandlers,
    registerEmotionHandlers,
    registerContextHandlers,
    registerAgentHandlers,
    registerPomodoroHandlers,
    registerClipboardHandlers,
    registerKnowledgeCardHandlers,
    registerCalendarHandlers,
} = require("./ipcRegisterHandlers");
const {
    ensurePomodoroJson,
    savePomodoroTaskList,
    createPomodoroTaskRecord,
    updatePomodoroTaskRecord,
    deletePomodoroTaskRecord,
} = require("./pomodoroStore");
const {createClipboardStore} = require("./clipboardStore");
const {
    ensureCalendarPlanJson,
    readCalendarData,
    listCalendarTodos,
    createCalendarTodoRecord,
    updateCalendarTodoRecord,
    deleteCalendarTodoRecord,
    listAiDiaries,
    createAiDiaryRecord,
    updateAiDiaryRecord,
    deleteAiDiaryRecord,
    getCalendarDayDetail,
} = require("./calendarStore");
const fs = require("fs/promises");
const {execFile} = require("child_process");
const {promisify} = require("util");
const {wm} = require("../window/WindowManager");
const {
    WINDOW_KEYS,
    AI_TOUCH_RESPONSE,
    POMODORO_JSON_PATH,
    AI_CONTEXT_JSON_PATH,
    AI_CONVERSATION_LOG_JSONL_PATH,
    AI_LONG_TERM_MEMORY_JSON_PATH,
    KNOWLEDGE_CARDS_JSON_PATH,
    AI_MEMORY_ROUTINE_JSON_PATH,
    CLIPBOARD_HISTORY_JSON_PATH,
    CALENDAR_PLAN_JSON_PATH,
    ENV_CONFIG,
    IPC_RUNTIME_CONFIG,
} = require('../config');
// Main-process IPC orchestration for chat, memory, cards, and agent wiring.
class IpcRegister{
    static EMOTION_LOG_PREFIX = IPC_RUNTIME_CONFIG.emotionLogPrefix;
    static assistantContext = [];
    static assistantLongTermMemory = [];
    static longTermMemoryFingerprintIndex = new Map();
    static knowledgeCards = [];
    static knowledgeCardsCache = {
        version: -1,
        categories: [],
        items: [],
    };
    static knowledgeCardsVersion = 0;
    static clipboardStore = createClipboardStore({
        dataPath: CLIPBOARD_HISTORY_JSON_PATH,
        clipboard,
        nativeImage,
        maxItems: IPC_RUNTIME_CONFIG.clipboardMaxItems,
    });
    static MAX_CONTEXT_MESSAGES = IPC_RUNTIME_CONFIG.maxContextMessages;
    static agentService = null;
    static memoryRoutineMeta = {
        lastExtractionDate: "",
        lastRunAt: "",
        lastStatus: "idle",
        lastAddedCount: 0,
        lastSkippedCount: 0,
        lastError: "",
    };
    static conversationLogEntriesCache = null;
    static execFileAsync = promisify(execFile);
    constructor(ipc){
    }
    static buildAiChatMessages(message){
        return buildAssistantChatMessages(this.assistantContext, message);
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
    static rebuildLongTermMemoryIndex(){
        this.longTermMemoryFingerprintIndex = new Map();
        this.assistantLongTermMemory.forEach((item, index)=>{
            const fingerprint = typeof item?.fingerprint === "string" ? item.fingerprint : "";
            if(fingerprint && !this.longTermMemoryFingerprintIndex.has(fingerprint)){
                this.longTermMemoryFingerprintIndex.set(fingerprint, index);
            }
        });
    }
    static findDuplicateMemoryIndex(title, content){
        const fingerprint = this.buildMemoryFingerprint(title, content);
        const fingerprintIndex = this.longTermMemoryFingerprintIndex.get(fingerprint);
        if(Number.isInteger(fingerprintIndex)
            && fingerprintIndex >= 0
            && fingerprintIndex < this.assistantLongTermMemory.length
            && this.assistantLongTermMemory[fingerprintIndex]?.fingerprint === fingerprint){
            return fingerprintIndex;
        }
        const normalizedTitle = title.trim().toLowerCase();
        const normalizedContent = content.trim().toLowerCase();
        for(let index = 0; index < this.assistantLongTermMemory.length; index += 1){
            const item = this.assistantLongTermMemory[index];
            if(item.fingerprint === fingerprint){
                return index;
            }
            const titleValue = item.title.trim().toLowerCase();
            const contentValue = item.content.trim().toLowerCase();
            if(titleValue === normalizedTitle
                || contentValue === normalizedContent
                || contentValue.includes(normalizedContent)
                || normalizedContent.includes(contentValue)){
                return index;
            }
        }
        return -1;
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
            this.rebuildLongTermMemoryIndex();
        }catch(err){
            if(err.code === "ENOENT"){
                this.assistantLongTermMemory = [];
                this.rebuildLongTermMemoryIndex();
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
    static async addLongTermMemory(data, options = {}){
        const persist = options?.persist !== false;
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
            this.rebuildLongTermMemoryIndex();
            if(persist){
                await this.saveLongTermMemory();
            }
            return merged;
        }
        record.createdAt = now;
        this.assistantLongTermMemory.unshift(record);
        this.rebuildLongTermMemoryIndex();
        if(persist){
            await this.saveLongTermMemory();
        }
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
        this.rebuildLongTermMemoryIndex();
        await this.saveLongTermMemory();
        return this.getLongTermMemoryData();
    }
    static buildMemoryExtractionMessages(contextItems){
        return buildMemoryExtractionPromptMessages(contextItems);
    }
    static parseLooseJson(text){
        const value = String(text || "").trim();
        if(!value){
            return null;
        }
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
    static parseJsonObject(text){
        return this.parseLooseJson(text);
    }
    static async extractLongTermMemoriesFromContext(){
        const contextItems = this.assistantContext.slice(-IPC_RUNTIME_CONFIG.memoryExtractionContextWindow);
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
            ...IPC_RUNTIME_CONFIG.modelParams.memoryExtraction,
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
            }, {persist: false}));
        }
        if(added.length){
            await this.saveLongTermMemory();
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
        if(this.knowledgeCardsCache.version !== this.knowledgeCardsVersion){
            const categoriesSet = new Set();
            const sortedItems = [...this.knowledgeCards].sort((a, b)=>{
                return this.compareText(b.updatedAt || b.createdAt, a.updatedAt || a.createdAt);
            });
            const items = sortedItems.map((item)=>{
                categoriesSet.add(item.category);
                return {
                    ...item,
                    summary: typeof item.summary === "string" && item.summary.trim()
                        ? item.summary.trim()
                        : this.buildKnowledgeCardFallbackSummary(item),
                };
            });
            this.knowledgeCardsCache = {
                version: this.knowledgeCardsVersion,
                categories: [...categoriesSet].sort((a, b)=>a.localeCompare(b, "zh-CN")),
                items,
            };
        }
        return {
            cardCount: this.knowledgeCards.length,
            categories: [...this.knowledgeCardsCache.categories],
            items: this.knowledgeCardsCache.items.map((item)=>({...item})),
        };
    }
    static touchKnowledgeCardsCache(){
        this.knowledgeCardsVersion += 1;
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
    static createAssistantContextRecord(role, message, createdAt = new Date().toISOString()){
        return {
            role,
            message: String(message || "").trim(),
            createdAt: typeof createdAt === "string" ? createdAt : new Date(createdAt).toISOString(),
        };
    }
    static getLocalDateKey(value = new Date()){
        const date = value instanceof Date ? value : new Date(value);
        if(Number.isNaN(date.getTime())){
            return "";
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
    static shiftDateKey(dateKey, offsetDays = 0){
        const [year, month, day] = String(dateKey || "").split("-").map((item)=>Number(item));
        const date = new Date(year, (month || 1) - 1, day || 1);
        date.setDate(date.getDate() + Number(offsetDays || 0));
        return this.getLocalDateKey(date);
    }
    static compareText(left, right){
        const a = String(left || "");
        const b = String(right || "");
        if(a === b){
            return 0;
        }
        return a < b ? -1 : 1;
    }
    static getAssistantContextByDate(dateKey){
        const targetDate = String(dateKey || "").trim();
        if(!targetDate){
            return [];
        }
        return this.assistantContext.filter((item)=>{
            if(typeof item?.createdAt !== "string" || !item.createdAt){
                return false;
            }
            return this.getLocalDateKey(item.createdAt) === targetDate;
        });
    }
    static buildConversationLogId(){
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    static async appendConversationLog(entry = {}){
        const line = `${JSON.stringify(entry)}\n`;
        await fs.appendFile(AI_CONVERSATION_LOG_JSONL_PATH, line, "utf-8");
        if(Array.isArray(this.conversationLogEntriesCache)){
            this.conversationLogEntriesCache.push(entry);
        }
    }
    static async readConversationLogEntries(){
        if(Array.isArray(this.conversationLogEntriesCache)){
            return [...this.conversationLogEntriesCache];
        }
        try{
            const raw = await fs.readFile(AI_CONVERSATION_LOG_JSONL_PATH, "utf8");
            const entries = raw
                .split(/\r?\n/)
                .map((line)=>line.trim())
                .filter(Boolean)
                .map((line)=>{
                    try{
                        return JSON.parse(line);
                    }catch(err){
                        return null;
                    }
                })
                .filter((item)=>item && typeof item === "object");
            this.conversationLogEntriesCache = entries;
            return [...entries];
        }catch(err){
            if(err.code === "ENOENT"){
                this.conversationLogEntriesCache = [];
                return [];
            }
            throw err;
        }
    }
    static async getAgentCallChain(args = {}){
        const runId = typeof args?.runId === "string" ? args.runId.trim() : "";
        const allowEmpty = args?.allowEmpty === true;
        const entries = await this.readConversationLogEntries();
        let target = null;
        const availableRunIds = [];
        const availableSet = new Set();
        for(let index = entries.length - 1; index >= 0; index -= 1){
            const item = entries[index];
            if(item?.type !== "assistant-exchange" || item?.mode !== "agent"){
                continue;
            }
            const itemRunId = String(item?.run?.runId || item?.runId || "").trim();
            if(itemRunId && !availableSet.has(itemRunId) && availableRunIds.length < 24){
                availableSet.add(itemRunId);
                availableRunIds.unshift(itemRunId);
            }
            if(!target){
                if(runId){
                    if(itemRunId === runId){
                        target = item;
                    }
                }else if(itemRunId){
                    target = item;
                }
            }
            if(target && availableRunIds.length >= 24){
                break;
            }
        }
        if(!target){
            if(allowEmpty){
                return {
                    runId: "",
                    createdAt: "",
                    traceCount: 0,
                    callChain: [],
                    traces: [],
                    userMessage: "",
                    assistantMessage: "",
                    availableRunIds: [],
                };
            }
            throw new Error(runId ? `Agent run not found: ${runId}` : "No recorded agent run is available.");
        }
        const traces = Array.isArray(target?.run?.traces) ? target.run.traces : [];
        const callChain = Array.isArray(target?.run?.callChain) ? target.run.callChain : [];
        return {
            runId: String(target?.run?.runId || target?.runId || "").trim(),
            createdAt: typeof target?.createdAt === "string" ? target.createdAt : "",
            mode: target?.mode || "agent",
            directMode: target?.run?.directMode === true || target?.directMode === true,
            status: target?.run?.status || "success",
            traceCount: traces.length,
            callChain,
            traces,
            userMessage: typeof target?.userMessage === "string" ? target.userMessage : "",
            assistantMessage: typeof target?.assistantMessage === "string" ? target.assistantMessage : "",
            availableRunIds,
        };
    }
    static async recordAssistantExchange(userMessage, assistantMessage, meta = {}){
        const createdAt = new Date().toISOString();
        const userRecord = this.createAssistantContextRecord("user", userMessage, createdAt);
        const assistantRecord = this.createAssistantContextRecord("assistant", assistantMessage, createdAt);
        this.assistantContext.push(userRecord);
        if(assistantRecord.message){
            this.assistantContext.push(assistantRecord);
        }
        this.trimAssistantContext();
        await this.saveAssistantContext();
        const runMeta = meta?.run && typeof meta.run === "object" ? meta.run : null;
        const logEntry = {
            id: this.buildConversationLogId(),
            type: "assistant-exchange",
            mode: typeof meta?.mode === "string" && meta.mode.trim() ? meta.mode.trim() : "assistant",
            directMode: meta?.directMode === true,
            createdAt,
            userMessage: userRecord.message,
            assistantMessage: assistantRecord.message,
            entries: assistantRecord.message ? [userRecord, assistantRecord] : [userRecord],
            contextWindow: {
                maxMessages: this.MAX_CONTEXT_MESSAGES,
                currentMessages: this.assistantContext.length,
            },
            runId: runMeta?.runId || "",
            run: runMeta || null,
        };
        try{
            await this.appendConversationLog(logEntry);
        }catch(err){
            console.warn("[conversation-log] append failed:", err?.message || err);
        }
        return logEntry;
    }
    static async runAiChat(message){
        const aiChatMessage = this.buildAiChatMessages(message);
        const response = await aiChat(aiChatMessage);
        const assistantReply = this.getAssistantReplyContent(response);
        await this.recordAssistantExchange(message, assistantReply, {mode: "assistant"});
        return response;
    }
    static async sleep(ms = 120){
        await new Promise((resolve)=>setTimeout(resolve, ms));
    }
    static snapshotClipboardState(){
        const formats = clipboard.availableFormats();
        const buffers = {};
        for(const format of formats){
            try{
                buffers[format] = clipboard.readBuffer(format);
            }catch(err){
                // ignore unsupported format reads
            }
        }
        return {
            text: clipboard.readText(),
            html: clipboard.readHTML(),
            rtf: clipboard.readRTF(),
            bookmark: clipboard.readBookmark(),
            image: clipboard.readImage(),
            buffers,
            formats,
        };
    }
    static restoreClipboardState(snapshot){
        if(!snapshot || typeof snapshot !== "object"){
            return;
        }
        try{
            clipboard.clear();
        }catch(err){
            // ignore clear failure
        }
        const writePayload = {};
        if(typeof snapshot.text === "string"){
            writePayload.text = snapshot.text;
        }
        if(typeof snapshot.html === "string" && snapshot.html){
            writePayload.html = snapshot.html;
        }
        if(typeof snapshot.rtf === "string" && snapshot.rtf){
            writePayload.rtf = snapshot.rtf;
        }
        if(snapshot.bookmark && typeof snapshot.bookmark.title === "string" && typeof snapshot.bookmark.url === "string"){
            writePayload.bookmark = snapshot.bookmark;
        }
        if(snapshot.image && !snapshot.image.isEmpty()){
            writePayload.image = snapshot.image;
        }
        if(Object.keys(writePayload).length){
            clipboard.write(writePayload);
        }
        const buffers = snapshot.buffers || {};
        for(const format of snapshot.formats || []){
            const buffer = buffers[format];
            if(!buffer){
                continue;
            }
            try{
                clipboard.writeBuffer(format, buffer);
            }catch(err){
                // ignore unsupported format writes
            }
        }
    }
    static parseEmotionExtractionJson(text){
        return this.parseLooseJson(text);
    }
    static ruleBasedEmotionSignal(text){
        const source = String(text || "").toLowerCase();
        if(!source.trim()){
            return {
                emotion: "neutral",
                tone: "flat",
                intensity: 0.45,
                confidence: 0.5,
                keywords: [],
                motionHint: {group: "Idle", index: 0},
            };
        }
        const groups = [
            {emotion: "joy", tone: "excited", words: ["开心", "高兴", "太好了", "太棒了", "快乐", "哈哈", "great", "awesome"], motionHint: {group: "Idle", index: 6}, intensity: 0.86},
            {emotion: "joy", tone: "warm", words: ["喜欢", "幸福", "温暖", "谢谢你", "感动", "嘿嘿"], motionHint: {group: "Idle", index: 2}, intensity: 0.68},
            {emotion: "sad", tone: "low", words: ["难过", "伤心", "失落", "遗憾", "沮丧", "sad", "upset"], motionHint: {group: "Idle", index: 4}, intensity: 0.62},
            {emotion: "angry", tone: "sharp", words: ["生气", "愤怒", "烦", "气死", "angry", "mad"], motionHint: {group: "TapBody", index: 0}, intensity: 0.8},
            {emotion: "surprised", tone: "sudden", words: ["惊讶", "震惊", "诶", "哇", "surprise", "unexpected"], motionHint: {group: "TapBody", index: 0}, intensity: 0.84},
            {emotion: "calm", tone: "steady", words: ["冷静", "平静", "稳定", "安心", "calm", "steady", "relax"], motionHint: {group: "Idle", index: 0}, intensity: 0.48},
            {emotion: "thinking", tone: "serious", words: ["分析", "推理", "步骤", "计划", "方案", "思考"], motionHint: {group: "Idle", index: 7}, intensity: 0.52},
            {emotion: "curious", tone: "light", words: ["为什么", "怎么", "是否", "能不能", "好奇", "想知道"], motionHint: {group: "Idle", index: 1}, intensity: 0.56},
        ];
        for(const group of groups){
            const hits = group.words.filter((word)=>source.includes(word));
            if(hits.length){
                return {
                    emotion: group.emotion,
                    tone: group.tone,
                    intensity: Math.min(0.95, group.intensity + Math.min(0.08, hits.length * 0.03)),
                    confidence: Math.min(0.95, 0.6 + hits.length * 0.12),
                    keywords: hits.slice(0, 4),
                    motionHint: group.motionHint,
                };
            }
        }
        return {
            emotion: "neutral",
            tone: "flat",
            intensity: 0.5,
            confidence: 0.55,
            keywords: [],
            motionHint: {group: "Idle", index: 0},
        };
    }
    static async extractEmotionForLive2d(text){
        const fallback = this.ruleBasedEmotionSignal(text);
        const model = ENV_CONFIG.AI_SUMMARY_MODEL || ENV_CONFIG.AI_MODEL;
        console.log(`${this.EMOTION_LOG_PREFIX} step1 input`, {
            hasText: Boolean(String(text || "").trim()),
            textLength: String(text || "").length,
            model: model || "none",
        });
        if(!model || !String(text || "").trim()){
            console.log(`${this.EMOTION_LOG_PREFIX} step2 skip-model use-fallback`, fallback);
            return fallback;
        }
        try{
            console.log(`${this.EMOTION_LOG_PREFIX} step2 model-request`);
            const response = await aiChatWithModel([
                {
                    role: "system",
                    message: [
                        "你是情绪标签提取器。",
                        "请从给定文本中提取主情绪，并映射一个 Live2D 动作建议。",
                        "只输出 JSON，不要输出任何额外文字。",
                        "JSON 格式：",
                        "{\"emotion\":\"joy|sad|angry|surprised|calm|thinking|curious|neutral\",\"tone\":\"excited|warm|low|sharp|sudden|steady|serious|light|flat\",\"intensity\":0.0,\"confidence\":0.0,\"keywords\":[\"词1\"],\"motionHint\":{\"group\":\"Idle|TapBody\",\"index\":0}}",
                    ].join("\n"),
                },
                {
                    role: "user",
                    message: String(text || "").slice(0, 2000),
                },
            ], {
                model,
                ...IPC_RUNTIME_CONFIG.modelParams.emotionExtraction,
            });
            const raw = this.getAssistantReplyContent(response);
            console.log(`${this.EMOTION_LOG_PREFIX} step3 model-raw`, raw);
            const parsed = this.parseEmotionExtractionJson(raw);
            if(!parsed || typeof parsed !== "object"){
                console.log(`${this.EMOTION_LOG_PREFIX} step4 parse-failed use-fallback`, fallback);
                return fallback;
            }
            const emotion = ["joy", "sad", "angry", "surprised", "calm", "thinking", "curious", "neutral"].includes(parsed.emotion)
                ? parsed.emotion
                : fallback.emotion;
            const tone = ["excited", "warm", "low", "sharp", "sudden", "steady", "serious", "light", "flat"].includes(parsed.tone)
                ? parsed.tone
                : (fallback.tone || "flat");
            const intensityNumber = Number(parsed.intensity);
            const intensity = Number.isFinite(intensityNumber)
                ? Math.max(0, Math.min(1, Number(intensityNumber.toFixed(2))))
                : (fallback.intensity ?? 0.5);
            const confidenceNumber = Number(parsed.confidence);
            const confidence = Number.isFinite(confidenceNumber)
                ? Math.max(0, Math.min(1, Number(confidenceNumber.toFixed(2))))
                : fallback.confidence;
            const keywords = Array.isArray(parsed.keywords)
                ? parsed.keywords.filter((item)=>typeof item === "string" && item.trim()).slice(0, 4)
                : fallback.keywords;
            const hintGroup = parsed?.motionHint?.group === "TapBody" ? "TapBody" : "Idle";
            const hintIndex = Number.isFinite(Number(parsed?.motionHint?.index)) ? Number(parsed.motionHint.index) : (fallback?.motionHint?.index ?? 0);
            const normalized = {
                emotion,
                tone,
                intensity,
                confidence,
                keywords,
                motionHint: {
                    group: hintGroup,
                    index: Math.max(0, Math.floor(hintIndex)),
                },
            };
            console.log(`${this.EMOTION_LOG_PREFIX} step5 model-normalized`, normalized);
            return normalized;
        }catch(err){
            console.warn(`${this.EMOTION_LOG_PREFIX} stepX model-error use-fallback`, err?.message || err);
            return fallback;
        }
    }
    static stripMarkdownForSummary(content){
        return stripMarkdownForSummary(content);
    }
    static buildKnowledgeCardFallbackSummary(data){
        return buildKnowledgeCardFallbackSummary(data);
    }
    static buildKnowledgeCardSummaryMessages(data){
        return buildKnowledgeCardSummaryPromptMessages(data);
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
                ...IPC_RUNTIME_CONFIG.modelParams.knowledgeCardSummary,
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
            this.touchKnowledgeCardsCache();
        }catch(err){
            if(err.code === "ENOENT"){
                this.knowledgeCards = [];
                await this.saveKnowledgeCards();
                this.touchKnowledgeCardsCache();
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
        this.touchKnowledgeCardsCache();
        return card;
    }
    static async updateKnowledgeCardRecord(data){
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
        card.summary = await this.resolveKnowledgeCardSummary(payload);
        card.category = payload.category;
        card.source = payload.source;
        card.updatedAt = new Date().toISOString();
        await this.saveKnowledgeCards();
        this.touchKnowledgeCardsCache();
        return card;
    }
    static async deleteKnowledgeCardRecord(cardId){
        if(typeof cardId !== "string" || !cardId.trim()){
            throw new Error("Card id is required.");
        }
        const nextCards = this.knowledgeCards.filter((item)=>item.id !== cardId);
        if(nextCards.length === this.knowledgeCards.length){
            throw new Error("Card not found.");
        }
        this.knowledgeCards = nextCards;
        await this.saveKnowledgeCards();
        this.touchKnowledgeCardsCache();
        return this.getKnowledgeCardsData();
    }
    static async ensureCalendarPlanJson(dataPath){
        return await ensureCalendarPlanJson(dataPath);
    }
    static async getCalendarPlanData(){
        return await readCalendarData(CALENDAR_PLAN_JSON_PATH, {useRemote: false});
    }
    static async getCalendarDayDetail(date){
        return await getCalendarDayDetail(CALENDAR_PLAN_JSON_PATH, date, {useRemote: false});
    }
    static async listCalendarTodos(filters = {}){
        return await listCalendarTodos(CALENDAR_PLAN_JSON_PATH, filters);
    }
    static async createCalendarTodo(payload = {}){
        return await createCalendarTodoRecord(CALENDAR_PLAN_JSON_PATH, payload);
    }
    static async updateCalendarTodo(payload = {}){
        return await updateCalendarTodoRecord(CALENDAR_PLAN_JSON_PATH, payload);
    }
    static async deleteCalendarTodo(id){
        return await deleteCalendarTodoRecord(CALENDAR_PLAN_JSON_PATH, id);
    }
    static async listAiDiaries(filters = {}){
        return await listAiDiaries(CALENDAR_PLAN_JSON_PATH, filters);
    }
    static async findAiDiaryByDate(date){
        const result = await this.listAiDiaries({date});
        return Array.isArray(result?.items) && result.items.length ? result.items[0] : null;
    }
    static buildAiDiaryWriterMessages(payload = {}){
        const date = typeof payload?.date === "string" && payload.date.trim()
            ? payload.date.trim()
            : new Date().toISOString().slice(0, 10);
        const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
        const sourceContextItems = Array.isArray(payload?.contextItems)
            ? payload.contextItems
            : (
                payload?.restrictToTodayContext === true
                    ? this.getAssistantContextByDate(this.getLocalDateKey(new Date()))
                    : this.assistantContext.slice(-IPC_RUNTIME_CONFIG.aiDiaryContextWindow)
            );
        const contextText = sourceContextItems
            .map((item)=>{
                const timePart = typeof item?.createdAt === "string" && item.createdAt
                    ? `[${this.getLocalDateKey(item.createdAt)} ${new Date(item.createdAt).toLocaleTimeString("zh-CN", {hour12: false})}] `
                    : "";
                return `${timePart}${item.role}: ${item.message}`;
            })
            .join("\n") || "无额外上下文。";
        return buildAiDiaryWriterPromptMessages({
            date,
            prompt,
            contextText,
        });
    }
    static async resolveAiDiaryContent(payload = {}){
        const directContent = typeof payload?.content === "string" ? payload.content.trim() : "";
        if(directContent && payload?.autoGenerate !== true){
            return {
                title: typeof payload?.title === "string" ? payload.title.trim() : "AI 日记",
                content: directContent,
                mood: typeof payload?.mood === "string" ? payload.mood.trim() : "",
            };
        }
        const model = ENV_CONFIG.AI_SUMMARY_MODEL || ENV_CONFIG.AI_MODEL;
        if(!model){
            throw new Error("Missing model configuration for AI diary.");
        }
        const response = await aiChatWithModel(this.buildAiDiaryWriterMessages(payload), {
            model,
            ...IPC_RUNTIME_CONFIG.modelParams.aiDiary,
        });
        const raw = this.getAssistantReplyContent(response);
        const parsed = this.parseJsonObject(raw);
        if(parsed && typeof parsed === "object"){
            const title = typeof parsed?.title === "string" && parsed.title.trim()
                ? parsed.title.trim()
                : (typeof payload?.title === "string" && payload.title.trim() ? payload.title.trim() : "AI 日记");
            const content = typeof parsed?.content === "string" && parsed.content.trim()
                ? parsed.content.trim()
                : raw.trim();
            const mood = typeof parsed?.mood === "string" ? parsed.mood.trim() : (typeof payload?.mood === "string" ? payload.mood.trim() : "");
            if(!content){
                throw new Error("AI diary generation returned empty content.");
            }
            return {title, content, mood};
        }
        if(!raw.trim()){
            throw new Error("AI diary generation returned empty content.");
        }
        return {
            title: typeof payload?.title === "string" && payload.title.trim() ? payload.title.trim() : "AI 日记",
            content: raw.trim(),
            mood: typeof payload?.mood === "string" ? payload.mood.trim() : "",
        };
    }
    static async createAiDiary(payload = {}){
        const date = typeof payload?.date === "string" && payload.date.trim()
            ? payload.date.trim()
            : new Date().toISOString().slice(0, 10);
        if(payload?.dedupeByDate === true){
            const existing = await this.findAiDiaryByDate(date);
            if(existing){
                return {
                    item: existing,
                    data: await readCalendarData(CALENDAR_PLAN_JSON_PATH, {useRemote: false}),
                    reused: true,
                };
            }
        }
        const resolved = await this.resolveAiDiaryContent(payload);
        return await createAiDiaryRecord(CALENDAR_PLAN_JSON_PATH, {
            ...payload,
            date,
            title: resolved.title,
            content: resolved.content,
            mood: resolved.mood,
        });
    }
    static async maybeGenerateYesterdayAiDiaryOnStartup(){
        const today = this.getLocalDateKey(new Date());
        const yesterday = this.shiftDateKey(today, -1);
        const yesterdayContext = this.getAssistantContextByDate(yesterday);
        if(!yesterdayContext.length){
            return {ok: true, skipped: "no-context", date: yesterday};
        }
        const existing = await this.findAiDiaryByDate(yesterday);
        if(existing){
            return {ok: true, skipped: "already-exists", date: yesterday, diaryId: existing.id};
        }
        const result = await this.createAiDiary({
            date: yesterday,
            autoGenerate: true,
            dedupeByDate: true,
            source: "startup-routine",
            prompt: "请根据昨天的真实对话记录生成一篇 AI 日记，内容要诚实、自然，并与昨天发生的交流一致。",
            contextItems: yesterdayContext,
        });
        return {ok: true, created: true, date: yesterday, diaryId: result?.item?.id || ""};
    }
    static async updateAiDiary(payload = {}){
        return await updateAiDiaryRecord(CALENDAR_PLAN_JSON_PATH, payload);
    }
    static async deleteAiDiary(id){
        return await deleteAiDiaryRecord(CALENDAR_PLAN_JSON_PATH, id);
    }
    static async createPomodoroTaskRecord(data){
        return await createPomodoroTaskRecord(POMODORO_JSON_PATH, data);
    }
    static async savePomodoroTaskList(data){
        return await savePomodoroTaskList(POMODORO_JSON_PATH, data);
    }
    static async updatePomodoroTaskRecord(data){
        return await updatePomodoroTaskRecord(POMODORO_JSON_PATH, data);
    }
    static async deletePomodoroTaskRecord(taskId){
        return await deletePomodoroTaskRecord(POMODORO_JSON_PATH, taskId);
    }
    static async loadClipboardHistory(){
        await this.clipboardStore.loadHistory();
    }
    static getClipboardSnapshotData(){
        return this.clipboardStore.getClipboardSnapshotData();
    }
    static getClipboardHistoryData(){
        return this.clipboardStore.getClipboardHistoryData();
    }
    static async captureClipboardRecord(options = {}){
        return await this.clipboardStore.captureClipboardRecord(options);
    }
    static async clearClipboardHistory(){
        return await this.clipboardStore.clearClipboardHistory();
    }
    static async deleteClipboardItem(id){
        return await this.clipboardStore.deleteClipboardItem(id);
    }
    static async pinClipboardItem(id, pinned = true){
        return await this.clipboardStore.pinClipboardItem(id, pinned);
    }
    static async copyClipboardItem(id){
        return await this.clipboardStore.copyClipboardItem(id);
    }
    static registerPing(){
        // Core one-off handlers are grouped here to avoid scattering tiny IPC registrations.
        registerCoreHandlers(this, {wm, WINDOW_KEYS, AI_TOUCH_RESPONSE});
    }
    static registerAiChat(){
        registerAiChatHandlers(this);
    }
    static registerEmotionTools(){
        registerEmotionHandlers(this);
    }
    static registerAiContextManager(){
        registerContextHandlers(this);
    }
    static registerAgent(){
        registerAgentHandlers(this);
    }
    static async ensurePomodoroJson(dataPath){
        return await ensurePomodoroJson(dataPath);
    }
    static registerPomodoroJson(){
        registerPomodoroHandlers(this, {POMODORO_JSON_PATH});
    }
    static registerClipboard(){
        registerClipboardHandlers(this);
    }
    static registerKnowledgeCards(){
        registerKnowledgeCardHandlers(this);
    }
    static registerCalendar(){
        registerCalendarHandlers(this);
    }

    static async registerAll(){
        await this.loadAssistantContext();
        await this.loadLongTermMemory();
        await this.loadKnowledgeCards();
        await this.loadMemoryRoutineMeta();
        await this.loadClipboardHistory();
        await this.ensureCalendarPlanJson(CALENDAR_PLAN_JSON_PATH);
        this.agentService = new AgentService({
            getAssistantContext: ()=>[...this.assistantContext],
            getLongTermMemory: ()=>[...this.assistantLongTermMemory],
            addLongTermMemory: async (data)=>await this.addLongTermMemory(data),
            deleteLongTermMemory: async (memoryId)=>await this.deleteLongTermMemory(memoryId),
            extractLongTermMemories: async ()=>await this.extractLongTermMemoriesFromContext(),
            getMemoryRoutineMeta: ()=>this.getMemoryRoutineMeta(),
            getKnowledgeCards: ()=>[...this.knowledgeCards],
            createKnowledgeCard: async (data)=>await this.createKnowledgeCardRecord(data),
            updateKnowledgeCard: async (data)=>await this.updateKnowledgeCardRecord(data),
            deleteKnowledgeCard: async (cardId)=>await this.deleteKnowledgeCardRecord(cardId),
            getPomodoroData: async ()=>await this.ensurePomodoroJson(POMODORO_JSON_PATH),
            createPomodoroTask: async (data)=>await this.createPomodoroTaskRecord(data),
            updatePomodoroTask: async (data)=>await this.updatePomodoroTaskRecord(data),
            deletePomodoroTask: async (taskId)=>await this.deletePomodoroTaskRecord(taskId),
            getCalendarDayDetail: async (date)=>await this.getCalendarDayDetail(date),
            listCalendarTodos: async (filters)=>await this.listCalendarTodos(filters),
            createCalendarTodo: async (data)=>await this.createCalendarTodo(data),
            updateCalendarTodo: async (data)=>await this.updateCalendarTodo(data),
            deleteCalendarTodo: async (id)=>await this.deleteCalendarTodo(id),
            listAiDiaries: async (filters)=>await this.listAiDiaries(filters),
            createAiDiary: async (data)=>await this.createAiDiary(data),
            updateAiDiary: async (data)=>await this.updateAiDiary(data),
            deleteAiDiary: async (id)=>await this.deleteAiDiary(id),
            getAgentCallChain: async (args)=>await this.getAgentCallChain(args),
            requestCameraCapture: async (name = "camera") => {
                const targetWindow = wm.get("assistant");
                if (!targetWindow || targetWindow.isDestroyed()) {
                    throw new Error("Assistant window is not available for camera capture.");
                }
                const safeName = JSON.stringify(String(name || "camera"));
                return await targetWindow.webContents.executeJavaScript(`
                    (async () => {
                        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
                            throw new Error("Current renderer cannot access the camera.");
                        }
                        const stream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                width: { ideal: 1280 },
                                height: { ideal: 720 },
                                facingMode: "user"
                            },
                            audio: false
                        });
                        try {
                            const video = document.createElement("video");
                            video.autoplay = true;
                            video.muted = true;
                            video.playsInline = true;
                            video.srcObject = stream;
                            await video.play();
                            if (video.readyState < 2) {
                                await new Promise((resolve) => {
                                    video.onloadedmetadata = () => resolve();
                                });
                            }
                            await new Promise((resolve) => window.setTimeout(resolve, 180));
                            const width = video.videoWidth || 1280;
                            const height = video.videoHeight || 720;
                            const canvas = document.createElement("canvas");
                            canvas.width = width;
                            canvas.height = height;
                            const context = canvas.getContext("2d");
                            if (!context) {
                                throw new Error("Camera canvas is unavailable.");
                            }
                            context.drawImage(video, 0, 0, width, height);
                            return {
                                name: ${safeName},
                                width,
                                height,
                                dataUrl: canvas.toDataURL("image/png"),
                            };
                        } finally {
                            stream.getTracks().forEach((track) => track.stop());
                        }
                    })()
                `, true);
            },
        });
        await this.agentService.ensureReady();
        await this.maybeRunDailyMemoryExtraction();
        try{
            await this.maybeGenerateYesterdayAiDiaryOnStartup();
        }catch(err){
            console.warn("[ai-diary] startup generation failed:", err?.message || err);
        }
        this.registerPing();
        this.registerAiChat();
        this.registerEmotionTools();
        this.registerAiContextManager();
        this.registerAgent();
        this.registerPomodoroJson();
        this.registerClipboard();
        this.registerKnowledgeCards();
        this.registerCalendar();
    }

}
const ipcRegister = IpcRegister;
module.exports = {ipcRegister, IpcRegister};
