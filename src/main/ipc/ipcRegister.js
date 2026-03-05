const {ipcMain, clipboard, nativeImage} = require('electron');
const {aiChat, aiChatWithModel} = require('./aiService.js');
const {AgentService} = require("./agentService");
const {buildAssistantChatMessages} = require("./assistantPrompt");
const {
    buildKnowledgeCardSummaryMessages: buildKnowledgeCardSummaryPromptMessages,
    buildMemoryExtractionMessages: buildMemoryExtractionPromptMessages,
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
    registerQuickFloatHandlers,
} = require("./ipcRegisterHandlers");
const fs = require("fs/promises");
const {execFile} = require("child_process");
const {promisify} = require("util");
const {wm} = require("../window/WindowManager");
const {
    WIDTH,
    HEIGHT,
    WINDOW_KEYS,
    AI_TOUCH_RESPONSE,
    POMODORO_JSON_PATH,
    AI_CONTEXT_JSON_PATH,
    AI_LONG_TERM_MEMORY_JSON_PATH,
    KNOWLEDGE_CARDS_JSON_PATH,
    AI_MEMORY_ROUTINE_JSON_PATH,
    CLIPBOARD_HISTORY_JSON_PATH,
    ENV_CONFIG,
} = require('../config');
// Main-process IPC orchestration for chat, memory, cards, and agent wiring.
class ipcRegister{
    static EMOTION_LOG_PREFIX = "[emotion-pipeline]";
    static assistantContext = [];
    static assistantLongTermMemory = [];
    static knowledgeCards = [];
    static clipboardHistory = [];
    static MAX_CLIPBOARD_HISTORY_ITEMS = 120;
    static MAX_CONTEXT_MESSAGES = 48;
    static agentService = null;
    static memoryRoutineMeta = {
        lastExtractionDate: "",
        lastRunAt: "",
        lastStatus: "idle",
        lastAddedCount: 0,
        lastSkippedCount: 0,
        lastError: "",
    };
    static execFileAsync = promisify(execFile);
    static quickFloatFeatureEnabled = true;
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
        return buildMemoryExtractionPromptMessages(contextItems);
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
    static async triggerSystemCopyShortcut(){
        if(process.platform !== "win32"){
            return;
        }
        const script = "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')";
        await this.execFileAsync("powershell", ["-NoProfile", "-Command", script], {windowsHide: true});
    }
    static normalizeSelectedText(value){
        return String(value || "")
            .replace(/\r/g, "")
            .replace(/\u0000/g, "")
            .trim();
    }
    static async captureSelectedTextFromUiAutomation(){
        if(process.platform !== "win32"){
            return {text: "", source: "unsupported-platform", anchor: null};
        }
        const script = [
            "Add-Type -AssemblyName UIAutomationClient",
            "$focused=[System.Windows.Automation.AutomationElement]::FocusedElement",
            "if($null -eq $focused){",
            "$obj=@{text='';anchor=$null}; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Output ($obj | ConvertTo-Json -Compress); return",
            "}",
            "$text=''",
            "$anchor=$null",
            "try {",
            "$pattern=$focused.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)",
            "if($null -ne $pattern){",
            "$ranges=$pattern.GetSelection()",
            "if($null -ne $ranges -and $ranges.Length -gt 0){",
            "$range=$ranges[0]",
            "$text=$range.GetText(-1)",
            "$rects=$range.GetBoundingRectangles()",
            "if($null -ne $rects -and $rects.Length -ge 4){",
            "$lastBlock=[math]::Floor(($rects.Length / 4) - 1)",
            "$i=[int]($lastBlock * 4)",
            "$x=[double]$rects[$i]",
            "$y=[double]$rects[$i+1]",
            "$w=[double]$rects[$i+2]",
            "$h=[double]$rects[$i+3]",
            "$anchor=@{ x=[int][math]::Round($x + $w); y=[int][math]::Round($y + $h) }",
            "}",
            "}",
            "}",
            "} catch {}",
            "$obj=@{text=$text;anchor=$anchor}",
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
            "Write-Output ($obj | ConvertTo-Json -Compress -Depth 4)",
        ].join("; ");
        try{
            const {stdout} = await this.execFileAsync("powershell", ["-NoProfile", "-Command", script], {
                windowsHide: true,
                maxBuffer: 1024 * 1024,
            });
            const raw = String(stdout || "").trim();
            let parsed = {};
            if(raw){
                try{
                    parsed = JSON.parse(raw);
                }catch(err){
                    parsed = {text: raw, anchor: null};
                }
            }
            const anchor = parsed?.anchor && Number.isFinite(Number(parsed.anchor.x)) && Number.isFinite(Number(parsed.anchor.y))
                ? {x: Number(parsed.anchor.x), y: Number(parsed.anchor.y)}
                : null;
            return {
                text: this.normalizeSelectedText(parsed?.text || ""),
                source: "uia-selection",
                anchor,
            };
        }catch(err){
            return {text: "", source: "uia-error", anchor: null};
        }
    }
    static async captureSelectedTextFromActiveApp(){
        const uiSelection = await this.captureSelectedTextFromUiAutomation();
        if(uiSelection.text){
            return uiSelection;
        }
        throw new Error("No selected text detected by UIAutomation.");
    }
    static setQuickFloatFeatureEnabled(enabled){
        this.quickFloatFeatureEnabled = enabled !== false;
        return this.quickFloatFeatureEnabled;
    }
    static toggleQuickFloatFeatureEnabled(){
        this.quickFloatFeatureEnabled = !this.quickFloatFeatureEnabled;
        return this.quickFloatFeatureEnabled;
    }
    static getQuickFloatFeatureEnabled(){
        return this.quickFloatFeatureEnabled;
    }
    static buildQuickTranslateMessages(text, targetLanguage = "中文"){
        const source = String(text || "").trim();
        const target = String(targetLanguage || "").trim() || "中文";
        if(!source){
            throw new Error("Text is required.");
        }
        return [
            {
                role: "system",
                content: "你是翻译助手。只输出翻译结果本身，不要解释，不要加前后缀,不要使用md格式。",
            },
            {
                role: "user",
                content: `请把下面文本翻译成${target}：\n${source}`,
            },
        ];
    }
    static buildQuickExplainMessages(text, targetLanguage = "中文"){
        const source = String(text || "").trim();
        const target = String(targetLanguage || "").trim() || "中文";
        if(!source){
            throw new Error("Text is required.");
        }
        return [
            {
                role: "system",
                content: "你是解释助手。给出简洁、易懂的解释，可包含关键词释义。不要编造来源,不要使用md格式",
            },
            {
                role: "user",
                content: `请用${target}解释下面文本的含义，并保持简洁：\n${source}`,
            },
        ];
    }
    static async runQuickTranslateText(text, targetLanguage = "中文"){
        const messages = this.buildQuickTranslateMessages(text, targetLanguage);
        const response = await aiChatWithModel(messages, {
            model: ENV_CONFIG.AI_MODEL,
            temperature: 0.1,
            maxTokens: 1024,
        });
        return {
            text: this.getAssistantReplyContent(response).trim(),
            model: ENV_CONFIG.AI_MODEL,
            mode: "translate",
        };
    }
    static async runQuickExplainText(text, targetLanguage = "中文"){
        const messages = this.buildQuickExplainMessages(text, targetLanguage);
        const response = await aiChatWithModel(messages, {
            model: ENV_CONFIG.AI_MODEL,
            temperature: 0.2,
            maxTokens: 1024,
        });
        return {
            text: this.getAssistantReplyContent(response).trim(),
            model: ENV_CONFIG.AI_MODEL,
            mode: "explain",
        };
    }
    static parseEmotionExtractionJson(text){
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
        }
        return null;
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
                temperature: 0,
                maxTokens: 180,
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
        return this.getKnowledgeCardsData();
    }
    static normalizePomodoroTaskPayload(data, options = {}){
        const title = typeof data?.title === "string" ? data.title.trim() : "";
        const workMinutes = Number(data?.workMinutes);
        const restMinutes = Number(data?.restMinutes);
        const repeatTimes = Number(data?.repeatTimes);
        if(!title){
            throw new Error("Pomodoro task title is required.");
        }
        if(!Number.isFinite(workMinutes) || workMinutes <= 0 || workMinutes > 99){
            throw new Error("workMinutes must be between 1 and 99.");
        }
        if(!Number.isFinite(restMinutes) || restMinutes <= 0 || restMinutes > 99){
            throw new Error("restMinutes must be between 1 and 99.");
        }
        if(!Number.isFinite(repeatTimes) || repeatTimes <= 0 || repeatTimes > 99){
            throw new Error("repeatTimes must be between 1 and 99.");
        }
        const idRaw = options.requireId ? Number(data?.id) : null;
        const id = Number.isFinite(idRaw) ? idRaw : null;
        if(options.requireId && id == null){
            throw new Error("Pomodoro task id is required.");
        }
        return {
            id,
            title,
            workTime: Math.round(workMinutes * 60000),
            restTime: Math.round(restMinutes * 60000),
            repeatTimes: Math.round(repeatTimes),
        };
    }
    static getNextPomodoroTaskId(tasks = []){
        const maxId = tasks.reduce((max, item)=>Math.max(max, Number(item?.id) || 0), 0);
        return maxId + 1;
    }
    static async createPomodoroTaskRecord(data){
        const payload = this.normalizePomodoroTaskPayload(data);
        const tasks = await this.ensurePomodoroJson(POMODORO_JSON_PATH);
        const nextTask = {
            id: this.getNextPomodoroTaskId(tasks),
            title: payload.title,
            workTime: payload.workTime,
            restTime: payload.restTime,
            repeatTimes: payload.repeatTimes,
        };
        const next = [...tasks, nextTask];
        await fs.writeFile(POMODORO_JSON_PATH, JSON.stringify(next, null, 2), "utf-8");
        return {task: nextTask, count: next.length};
    }
    static async updatePomodoroTaskRecord(data){
        const payload = this.normalizePomodoroTaskPayload(data, {requireId: true});
        const tasks = await this.ensurePomodoroJson(POMODORO_JSON_PATH);
        const index = tasks.findIndex((item)=>Number(item?.id) === payload.id);
        if(index === -1){
            throw new Error("Pomodoro task not found.");
        }
        tasks[index] = {
            ...tasks[index],
            title: payload.title,
            workTime: payload.workTime,
            restTime: payload.restTime,
            repeatTimes: payload.repeatTimes,
        };
        await fs.writeFile(POMODORO_JSON_PATH, JSON.stringify(tasks, null, 2), "utf-8");
        return {task: tasks[index], count: tasks.length};
    }
    static async deletePomodoroTaskRecord(taskId){
        const id = Number(taskId);
        if(!Number.isFinite(id)){
            throw new Error("Pomodoro task id is required.");
        }
        const tasks = await this.ensurePomodoroJson(POMODORO_JSON_PATH);
        const next = tasks.filter((item)=>Number(item?.id) !== id);
        if(next.length === tasks.length){
            throw new Error("Pomodoro task not found.");
        }
        await fs.writeFile(POMODORO_JSON_PATH, JSON.stringify(next, null, 2), "utf-8");
        return {deletedId: id, count: next.length};
    }
    static normalizeClipboardHistory(data){
        if(!Array.isArray(data)){
            return [];
        }
        return data
            .filter((item)=>item && typeof item.id === "string")
            .map((item)=>({
                id: item.id,
                type: item.type === "image" || item.type === "mixed" ? item.type : "text",
                text: typeof item.text === "string" ? item.text : "",
                textPreview: typeof item.textPreview === "string" ? item.textPreview : "",
                hasImage: item.hasImage === true,
                imageWidth: Number.isFinite(Number(item.imageWidth)) ? Number(item.imageWidth) : 0,
                imageHeight: Number.isFinite(Number(item.imageHeight)) ? Number(item.imageHeight) : 0,
                imageDataUrl: typeof item.imageDataUrl === "string" ? item.imageDataUrl : "",
                createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
                source: typeof item.source === "string" ? item.source : "manual",
                pinned: item.pinned === true,
                fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : "",
            }));
    }
    static async saveClipboardHistory(){
        await fs.writeFile(CLIPBOARD_HISTORY_JSON_PATH, JSON.stringify(this.clipboardHistory, null, 2), "utf-8");
    }
    static async loadClipboardHistory(){
        try{
            const raw = await fs.readFile(CLIPBOARD_HISTORY_JSON_PATH, "utf8");
            this.clipboardHistory = this.normalizeClipboardHistory(JSON.parse(raw));
        }catch(err){
            if(err.code === "ENOENT"){
                this.clipboardHistory = [];
                await this.saveClipboardHistory();
                return;
            }
            throw err;
        }
    }
    static buildClipboardFingerprint(payload){
        const text = String(payload?.text || "").trim();
        const imagePart = payload?.hasImage
            ? `${payload.imageWidth || 0}x${payload.imageHeight || 0}:${payload.imageDataUrl ? String(payload.imageDataUrl).slice(0, 120) : ""}`
            : "no-image";
        return `${text.slice(0, 300)}|${imagePart}`.toLowerCase();
    }
    static clipTextPreview(text){
        const value = String(text || "").replace(/\s+/g, " ").trim();
        if(!value){
            return "";
        }
        return value.length > 120 ? `${value.slice(0, 120).trim()}...` : value;
    }
    static getClipboardSnapshotData(){
        const text = clipboard.readText();
        const image = clipboard.readImage();
        const hasImage = image && !image.isEmpty();
        let imageWidth = 0;
        let imageHeight = 0;
        let imageDataUrl = "";
        if(hasImage){
            const size = image.getSize();
            imageWidth = size?.width || 0;
            imageHeight = size?.height || 0;
            try{
                const preview = image.resize({width: Math.min(220, imageWidth || 220)});
                imageDataUrl = preview.toDataURL();
            }catch(err){
                imageDataUrl = "";
            }
        }
        const textValue = typeof text === "string" ? text : "";
        const hasText = Boolean(textValue.trim());
        const type = hasText && hasImage ? "mixed" : (hasImage ? "image" : "text");
        const result = {
            type,
            text: textValue,
            textPreview: this.clipTextPreview(textValue),
            hasText,
            hasImage,
            imageWidth,
            imageHeight,
            imageDataUrl,
        };
        result.fingerprint = this.buildClipboardFingerprint(result);
        return result;
    }
    static getClipboardHistoryData(){
        const pinnedCount = this.clipboardHistory.filter((item)=>item.pinned).length;
        return {
            count: this.clipboardHistory.length,
            pinnedCount,
            items: [...this.clipboardHistory],
        };
    }
    static trimClipboardHistory(){
        if(this.clipboardHistory.length <= this.MAX_CLIPBOARD_HISTORY_ITEMS){
            return;
        }
        const pinnedItems = this.clipboardHistory.filter((item)=>item.pinned);
        const normalItems = this.clipboardHistory.filter((item)=>!item.pinned);
        const keepNormalCount = Math.max(0, this.MAX_CLIPBOARD_HISTORY_ITEMS - pinnedItems.length);
        this.clipboardHistory = [...pinnedItems, ...normalItems.slice(0, keepNormalCount)];
    }
    static async captureClipboardRecord(options = {}){
        const snapshot = this.getClipboardSnapshotData();
        if(!snapshot.hasText && !snapshot.hasImage){
            return {
                inserted: false,
                reason: "empty",
                snapshot,
                data: this.getClipboardHistoryData(),
            };
        }
        const duplicateIndex = this.clipboardHistory.findIndex((item)=>item.fingerprint === snapshot.fingerprint);
        if(duplicateIndex !== -1){
            const existing = this.clipboardHistory.splice(duplicateIndex, 1)[0];
            const merged = {
                ...existing,
                ...snapshot,
                id: existing.id,
                pinned: existing.pinned === true,
                createdAt: new Date().toISOString(),
                source: options.source || "manual",
            };
            this.clipboardHistory.unshift(merged);
            await this.saveClipboardHistory();
            return {
                inserted: false,
                reason: "duplicate",
                item: merged,
                snapshot,
                data: this.getClipboardHistoryData(),
            };
        }
        const item = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: snapshot.type,
            text: snapshot.text,
            textPreview: snapshot.textPreview,
            hasImage: snapshot.hasImage,
            imageWidth: snapshot.imageWidth,
            imageHeight: snapshot.imageHeight,
            imageDataUrl: snapshot.imageDataUrl || "",
            fingerprint: snapshot.fingerprint,
            source: options.source || "manual",
            pinned: false,
            createdAt: new Date().toISOString(),
        };
        this.clipboardHistory.unshift(item);
        this.trimClipboardHistory();
        await this.saveClipboardHistory();
        return {
            inserted: true,
            item,
            snapshot,
            data: this.getClipboardHistoryData(),
        };
    }
    static async clearClipboardHistory(){
        this.clipboardHistory = [];
        await this.saveClipboardHistory();
        return this.getClipboardHistoryData();
    }
    static async deleteClipboardItem(id){
        const itemId = typeof id === "string" ? id.trim() : "";
        if(!itemId){
            throw new Error("Clipboard item id is required.");
        }
        const next = this.clipboardHistory.filter((item)=>item.id !== itemId);
        if(next.length === this.clipboardHistory.length){
            throw new Error("Clipboard item not found.");
        }
        this.clipboardHistory = next;
        await this.saveClipboardHistory();
        return this.getClipboardHistoryData();
    }
    static async pinClipboardItem(id, pinned = true){
        const itemId = typeof id === "string" ? id.trim() : "";
        if(!itemId){
            throw new Error("Clipboard item id is required.");
        }
        const index = this.clipboardHistory.findIndex((item)=>item.id === itemId);
        if(index === -1){
            throw new Error("Clipboard item not found.");
        }
        this.clipboardHistory[index] = {
            ...this.clipboardHistory[index],
            pinned: pinned === true,
        };
        const updated = this.clipboardHistory.splice(index, 1)[0];
        if(updated.pinned){
            this.clipboardHistory.unshift(updated);
        }else{
            const firstUnpinned = this.clipboardHistory.findIndex((item)=>!item.pinned);
            if(firstUnpinned === -1){
                this.clipboardHistory.push(updated);
            }else{
                this.clipboardHistory.splice(firstUnpinned, 0, updated);
            }
        }
        await this.saveClipboardHistory();
        return this.getClipboardHistoryData();
    }
    static async copyClipboardItem(id){
        const itemId = typeof id === "string" ? id.trim() : "";
        if(!itemId){
            throw new Error("Clipboard item id is required.");
        }
        const item = this.clipboardHistory.find((entry)=>entry.id === itemId);
        if(!item){
            throw new Error("Clipboard item not found.");
        }
        if(item.text){
            clipboard.writeText(item.text);
        }
        if(item.hasImage && item.imageDataUrl){
            try{
                const image = nativeImage.createFromDataURL(item.imageDataUrl);
                if(image && !image.isEmpty()){
                    clipboard.writeImage(image);
                }
            }catch(err){
                // Keep text copy successful even if image restore fails.
            }
        }
        return {ok: true, id: item.id};
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
    static registerClipboard(){
        registerClipboardHandlers(this);
    }
    static registerKnowledgeCards(){
        registerKnowledgeCardHandlers(this);
    }
    static registerQuickFloat(){
        registerQuickFloatHandlers(this);
    }

    static async registerAll(){
        await this.loadAssistantContext();
        await this.loadLongTermMemory();
        await this.loadKnowledgeCards();
        await this.loadMemoryRoutineMeta();
        await this.loadClipboardHistory();
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
        });
        await this.agentService.ensureReady();
        await this.maybeRunDailyMemoryExtraction();
        this.registerPing();
        this.registerAiChat();
        this.registerEmotionTools();
        this.registerAiContextManager();
        this.registerAgent();
        this.registerPomodoroJson();
        this.registerClipboard();
        this.registerKnowledgeCards();
        this.registerQuickFloat();
    }

}
module.exports = {ipcRegister};
