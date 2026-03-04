const fs = require("fs/promises");
const path = require("path");
const {aiChatWithContent} = require("./aiService");
const {
    AGENT_LIBRARY_INDEX_JSON_PATH,
    AGENT_LIBRARY_ROOTS_JSON_PATH,
    AGENT_SCREENSHOT_DIR_PATH,
    ENV_CONFIG,
} = require("../config");
const {
    MAX_AGENT_STEPS,
    DEFAULT_LIBRARY_ROOTS,
    safeJsonParse,
    summarizeText,
    clampTraceOutput,
    normalizeToolArgs,
} = require("./agentShared");
const libraryTools = require("./agentLibraryTools");
const searchTools = require("./agentSearchTools");
const visionTools = require("./agentVisionTools");

// AgentService keeps orchestration state here and delegates tool-heavy domains to helper modules.
class AgentService {
    constructor(options) {
        this.getAssistantContext = options.getAssistantContext;
        this.getLongTermMemory = options.getLongTermMemory;
        this.addLongTermMemory = options.addLongTermMemory;
        this.deleteLongTermMemory = options.deleteLongTermMemory;
        this.extractLongTermMemories = options.extractLongTermMemories;
        this.getMemoryRoutineMeta = options.getMemoryRoutineMeta;
        this.getKnowledgeCards = options.getKnowledgeCards;
        this.createKnowledgeCard = options.createKnowledgeCard;
        this.getPomodoroData = options.getPomodoroData;
        this.libraryRoots = [];
        this.libraryIndex = {updatedAt: "", items: [], stats: null, categories: []};
    }

    async ensureReady() {
        await fs.mkdir(AGENT_SCREENSHOT_DIR_PATH, {recursive: true});
        this.libraryRoots = await this.loadLibraryRoots();
        await this.loadStoredLibraryIndex();
        await this.rebuildLibraryIndex();
    }

    async loadStoredLibraryIndex() {
        try {
            const raw = await fs.readFile(AGENT_LIBRARY_INDEX_JSON_PATH, "utf8");
            const data = safeJsonParse(raw);
            if (data && Array.isArray(data.items)) {
                this.libraryIndex = {
                    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
                    items: data.items,
                    stats: data.stats || null,
                    categories: Array.isArray(data.categories) ? data.categories : [],
                };
            }
        } catch (error) {
            if (error?.code !== "ENOENT") {
                console.warn("[agent] loadStoredLibraryIndex failed:", error.message);
            }
        }
    }

    async loadLibraryRoots() {
        try {
            const raw = await fs.readFile(AGENT_LIBRARY_ROOTS_JSON_PATH, "utf8");
            const data = safeJsonParse(raw);
            if (Array.isArray(data?.roots) && data.roots.length) {
                return data.roots
                    .filter((item) => typeof item === "string" && item.trim())
                    .map((item) => path.resolve(item));
            }
        } catch (error) {
            if (error?.code !== "ENOENT") {
                console.warn("[agent] loadLibraryRoots failed:", error.message);
            }
        }
        const roots = DEFAULT_LIBRARY_ROOTS.map((item) => path.resolve(item));
        await fs.writeFile(AGENT_LIBRARY_ROOTS_JSON_PATH, JSON.stringify({roots}, null, 2), "utf8");
        return roots;
    }

    async chat(userMessage) {
        if (this.shouldRunCapabilitySelfTest(userMessage)) {
            return await this.runCapabilitySelfTest(userMessage);
        }
        const traces = [];
        const conversation = [];
        const context = this.getAssistantContext().slice(-8);
        const memories = this.getLongTermMemory().slice(-10).map((item) => ({
            title: item.title,
            content: summarizeText(item.content, 160),
        }));

        conversation.push({
            role: "system",
            content: [
                {
                    type: "text",
                    text: this.buildAgentSystemPrompt(memories, context),
                },
            ],
        });
        conversation.push({
            role: "user",
            content: [{type: "text", text: userMessage}],
        });
        await this.runPrefetchTools(userMessage, traces, conversation);

        for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
            const response = await aiChatWithContent(conversation, {
                temperature: 0.2,
                maxTokens: 2048,
            });
            const content = response?.choices?.[0]?.message?.content ?? "";
            const action = this.parseAgentResponse(content);
            if (!action) {
                return {
                    mode: "agent",
                    content: content || "I do not have a usable result yet.",
                    traces,
                };
            }
            if (action.type === "final") {
                return {
                    mode: "agent",
                    content: action.content || content || "I do not have a usable result yet.",
                    traces,
                };
            }
            if (action.type !== "tool") {
                return {
                    mode: "agent",
                    content: content || "The tool chain did not return a usable result.",
                    traces,
                };
            }

            const args = normalizeToolArgs(action.args);
            let toolResult;
            try {
                toolResult = await this.runTool(action.tool, args);
                traces.push({
                    tool: action.tool,
                    status: "success",
                    input: args,
                    outputPreview: clampTraceOutput(toolResult),
                });
            } catch (error) {
                toolResult = {
                    error: error?.message || String(error),
                };
                traces.push({
                    tool: action.tool,
                    status: "error",
                    input: args,
                    outputPreview: clampTraceOutput(toolResult),
                });
            }

            conversation.push({
                role: "assistant",
                content: [{type: "text", text: JSON.stringify(action)}],
            });
            conversation.push({
                role: "user",
                content: [{
                    type: "text",
                    text: `Tool result for ${action.tool}: ${JSON.stringify(toolResult)}`,
                }],
            });
        }

        return {
            mode: "agent",
            content: "The agent reached the step limit. Ask me to continue with a narrower direction.",
            traces,
        };
    }

    shouldRunCapabilitySelfTest(userMessage) {
        const text = String(userMessage || "").toLowerCase();
        return /(测试|测一下|自测|检查).*(agent|能力|工具)/.test(text)
            || /(agent|工具).*(测试|自测|检查)/.test(text)
            || /test.*(agent|tool|capability)/.test(text);
    }

    async runCapabilitySelfTest(userMessage) {
        const traces = [];
        const results = [];
        const suite = [
            {tool: "get_context", args: {}},
            {tool: "get_memory", args: {}},
            {tool: "search_memory", args: {query: userMessage}},
            {tool: "get_memory_routine_status", args: {}},
            {tool: "list_cards", args: {}},
            {tool: "search_cards", args: {query: userMessage}},
            {tool: "get_library_overview", args: {}},
            {tool: "search_library", args: {query: userMessage}},
            {tool: "get_clipboard", args: {}},
            {tool: "list_screenshots", args: {}},
            {tool: "get_pomodoro_status", args: {}},
            {tool: "web_search", args: {query: userMessage}},
        ];

        for (const item of suite) {
            try {
                const output = await this.runTool(item.tool, item.args);
                traces.push({
                    tool: item.tool,
                    status: "success",
                    input: item.args,
                    outputPreview: clampTraceOutput(output),
                    phase: "self-test",
                });
                results.push(`- ${item.tool}: success`);
            } catch (error) {
                traces.push({
                    tool: item.tool,
                    status: "error",
                    input: item.args,
                    outputPreview: clampTraceOutput({error: error?.message || String(error)}),
                    phase: "self-test",
                });
                results.push(`- ${item.tool}: error - ${error?.message || String(error)}`);
            }
        }

        return {
            mode: "agent",
            content: [
                "Agent self-test finished.",
                "",
                ...results,
                "",
                "Skipped state-changing or environment-dependent tools: add_memory, delete_memory, extract_memory, create_card, capture_screen, analyze_clipboard_image, analyze_image, read_library_file, get_card.",
            ].join("\n"),
            traces,
        };
    }


    parseAgentResponse(content) {
        return searchTools.parseAgentResponse(content);
    }

    searchCards(query) {
        return searchTools.searchCards(this, query);
    }

    async getPomodoroStatus() {
        return visionTools.getPomodoroStatus(this);
    }

    getClipboardSnapshot() {
        return visionTools.getClipboardSnapshot();
    }


    async rebuildLibraryIndex() {
        return libraryTools.rebuildLibraryIndex(this);
    }

    buildLibraryItem(root, fullPath, stat, ext, excerpt, status, options = {}) {
        return libraryTools.buildLibraryItem(this, root, fullPath, stat, ext, excerpt, status, options);
    }

    async walkLibraryRoot(root, items, currentDir = root, previousMap = new Map(), stats = null, seenIds = new Set()) {
        return libraryTools.walkLibraryRoot(this, root, items, currentDir, previousMap, stats, seenIds);
    }

    searchMemory(query) {
        return searchTools.searchMemory(this, query);
    }

    getCapabilities() {
        const chunkCount = this.libraryIndex.items.reduce((sum, item) => sum + (item.chunkCount || 0), 0);
        return {
            visionEnabled: Boolean(ENV_CONFIG.AI_VISION_MODEL || ENV_CONFIG.VISION_MODEL),
            libraryRootCount: this.libraryRoots.length,
            libraryFileCount: this.libraryIndex.items.length,
            libraryChunkCount: chunkCount,
            libraryUpdatedAt: this.libraryIndex.updatedAt,
            tools: [
                "get_context",
                "get_memory",
                "search_memory",
                "get_memory_routine_status",
                "add_memory",
                "delete_memory",
                "extract_memory",
                "list_cards",
                "search_cards",
                "get_card",
                "create_card",
                "get_pomodoro_status",
                "get_clipboard",
                "analyze_clipboard_image",
                "get_library_overview",
                "search_library",
                "read_library_file",
                "web_search",
                "capture_screen",
                "list_screenshots",
                "analyze_image",
            ],
        };
    }

    getLibraryIndexData() {
        return libraryTools.getLibraryIndexData(this);
    }

    searchLibrary(query) {
        return libraryTools.searchLibrary(this, query);
    }

    getLibraryOverview() {
        return libraryTools.getLibraryOverview(this);
    }

    async readLibraryFile(requestedPath) {
        return libraryTools.readLibraryFile(this, requestedPath);
    }


    async captureScreen(name) {
        return visionTools.captureScreen(name);
    }

    async analyzeImage(args) {
        return visionTools.analyzeImage(args);
    }

    listCards(category) {
        return searchTools.listCards(this, category);
    }

    getCard(args) {
        return searchTools.getCard(this, args);
    }


    buildPrefetchPlan(userMessage) {
        return searchTools.buildPrefetchPlan(userMessage);
    }

    async runPrefetchTools(userMessage, traces, conversation) {
        return searchTools.runPrefetchTools(this, userMessage, traces, conversation);
    }


    async listScreenshots() {
        return visionTools.listScreenshots();
    }

    async analyzeClipboardImage(args = {}) {
        return visionTools.analyzeClipboardImage(this, args);
    }

    buildAgentSystemPrompt(memories, context) {
        return searchTools.buildAgentSystemPrompt(memories, context);
    }

    async runTool(toolName, args) {
        return searchTools.runTool(this, toolName, args);
    }


    async webSearch(query) {
        return searchTools.webSearch(this, query);
    }
}

module.exports = {
    AgentService,
};
