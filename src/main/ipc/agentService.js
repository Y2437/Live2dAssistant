const fs = require("fs/promises");
const path = require("path");
const {aiChatWithContent, aiChatWithContentStream} = require("./aiService");
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
const {buildAssistantFinalAnswerMessages} = require("./assistantPrompt");
const {
    buildAgentPrefetchPlannerPrompt,
    getAgentToolSpecs,
    buildAgentDirectToolPlannerPrompt,
    buildAgentDirectFinalPrompt,
} = require("./promptRegistry");

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

    async emitHook(hook, ...args) {
        if (typeof hook === "function") {
            await hook(...args);
        }
    }

    ensureNotAborted(signal) {
        if (signal?.aborted) {
            const error = new Error("Request canceled.");
            error.name = "AbortError";
            throw error;
        }
    }

    async requestAgentTurn(conversation, hooks = {}, options = {}) {
        this.ensureNotAborted(hooks.signal);
        const response = await aiChatWithContent(conversation, {
            temperature: options.temperature ?? 0.2,
            maxTokens: options.maxTokens ?? 2048,
            model: options.model || undefined,
            signal: hooks.signal,
            enableThinking: options.enableThinking !== false,
        });
        return {
            response,
            content: response?.choices?.[0]?.message?.content ?? "",
            streamMode: "internal",
        };
    }

    async streamFinalAnswer(conversation, hooks = {}) {
        this.ensureNotAborted(hooks.signal);

        if (typeof hooks.onText !== "function") {
            const response = await aiChatWithContent(conversation, {
                temperature: 0.4,
                maxTokens: 2048,
                model: hooks.model || undefined,
                signal: hooks.signal,
                enableThinking: false,
            });
            return response?.choices?.[0]?.message?.content ?? "";
        }

        let content = "";
        const response = await aiChatWithContentStream(conversation, {
            temperature: 0.4,
            maxTokens: 2048,
            model: hooks.model || undefined,
            signal: hooks.signal,
            enableThinking: false,
        }, {
            onChunk: async ({content: fullContent}) => {
                this.ensureNotAborted(hooks.signal);
                content = fullContent || content;
                await this.emitHook(hooks.onText, content);
            },
        });

        return response?.choices?.[0]?.message?.content ?? content ?? "";
    }

    formatTraceArgs(args = {}) {
        if (!args || typeof args !== "object") {
            return "";
        }
        const parts = Object.entries(args)
            .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
            .slice(0, 2)
            .map(([key, value]) => `${key}=${summarizeText(typeof value === "string" ? value : JSON.stringify(value), 48)}`);
        return parts.length ? ` (${parts.join(", ")})` : "";
    }

    getToolSpecs() {
        return getAgentToolSpecs();
    }

    normalizeAllowedTools(allowedTools = null) {
        const toolSpecs = this.getToolSpecs();
        const validTools = new Set(toolSpecs.map((item) => item.name));
        if (allowedTools == null) {
            return toolSpecs.map((item) => item.name);
        }
        if (!Array.isArray(allowedTools)) {
            return toolSpecs.map((item) => item.name);
        }
        const seen = new Set();
        return allowedTools
            .map((item) => String(item || "").trim())
            .filter((item) => item && validTools.has(item))
            .filter((item) => {
                if (seen.has(item)) {
                    return false;
                }
                seen.add(item);
                return true;
            });
    }

    ensureToolAllowed(toolName, allowedTools = null) {
        const allowedSet = new Set(this.normalizeAllowedTools(allowedTools));
        if (!allowedSet.has(toolName)) {
            throw new Error(`Tool not allowed for this request: ${toolName}`);
        }
    }

    normalizePrefetchPlan(rawPlan = [], allowedTools = null) {
        const requestAllowed = new Set(this.normalizeAllowedTools(allowedTools));
        const prefetchAllowed = new Set(this.getToolSpecs()
            .filter((item) => item.prefetchable)
            .map((item) => item.name)
            .filter((item) => requestAllowed.has(item)));
        const items = Array.isArray(rawPlan) ? rawPlan : (Array.isArray(rawPlan?.plan) ? rawPlan.plan : []);
        const seen = new Set();
        return items
            .map((item) => ({
                tool: String(item?.tool || "").trim(),
                args: normalizeToolArgs(item?.args),
            }))
            .filter((item) => item.tool && prefetchAllowed.has(item.tool))
            .filter((item) => {
                const key = `${item.tool}:${JSON.stringify(item.args)}`;
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            })
            .slice(0, 3);
    }

    async planPrefetchTools(userMessage, context, hooks = {}, allowedTools = null) {
        const conversation = [
            {
                role: "system",
                content: [{
                    type: "text",
                    text: buildAgentPrefetchPlannerPrompt({
                        userMessage,
                        allowedTools,
                        contextText: context.length
                            ? context.map((item) => `${item.role}: ${summarizeText(item.message, 120)}`).join("\n")
                            : "没有最近对话上下文。",
                    }),
                }],
            },
            {
                role: "user",
                content: [{type: "text", text: userMessage}],
            },
        ];
        try {
            const turn = await this.requestAgentTurn(conversation, hooks, {
                enableThinking: false,
                temperature: 0,
                maxTokens: 512,
            });
            const parsed = safeJsonParse(turn.content)
                || safeJsonParse(String(turn.content || "").replace(/```json|```/gi, "").trim());
            return this.normalizePrefetchPlan(parsed?.plan || [], allowedTools);
        } catch (error) {
            return [];
        }
    }

    async pushWorkflowTrace(traces, hooks, trace) {
        traces.push(trace);
        await this.emitHook(hooks.onTrace, trace, [...traces]);
    }

    createThinkingTrace(step, action) {
        const stepNumber = Number(step) + 1;
        if (!action) {
            return {
                kind: "thinking",
                phase: "thinking",
                status: "draft",
                title: `Thinking ${stepNumber}`,
                label: "draft",
                outputPreview: "Planner produced a direct answer draft without another tool call.",
            };
        }
        if (action.type === "tool") {
            return {
                kind: "thinking",
                phase: "thinking",
                status: "planned",
                title: `Thinking ${stepNumber}`,
                label: action.tool || "tool",
                outputPreview: `Selected ${action.tool}${this.formatTraceArgs(action.args)} to gather the next piece of information.`,
            };
        }
        if (action.type === "final") {
            return {
                kind: "thinking",
                phase: "thinking",
                status: "ready",
                title: `Thinking ${stepNumber}`,
                label: "final",
                outputPreview: "Planner determined that enough information is available for the final reply.",
            };
        }
        return {
            kind: "thinking",
            phase: "thinking",
            status: action.type || "update",
            title: `Thinking ${stepNumber}`,
            label: action.type || "update",
            outputPreview: "Planner updated the internal execution state.",
        };
    }

    buildWorkflowDigest(traces = []) {
        if (!Array.isArray(traces) || !traces.length) {
            return "No workflow notes.";
        }
        return traces.slice(-10).map((trace, index) => {
            if (trace.kind === "thinking") {
                return `- Thought ${index + 1}: ${trace.outputPreview || "Planner updated the execution state."}`;
            }
            const label = trace.tool || "tool";
            const status = trace.status || "done";
            const preview = trace.outputPreview || "No additional details.";
            return `- Tool ${label} (${status}): ${preview}`;
        }).join("\n");
    }

    buildFinalAnswerConversation({userMessage, context, traces, plannerDraft}) {
        return buildAssistantFinalAnswerMessages({
            contextItems: context,
            userMessage,
            workflowSummary: this.buildWorkflowDigest(traces),
            plannerDraft,
        });
    }

    async finalizeAgentResponse({userMessage, context, traces, hooks, plannerDraft = "", thinkingMode = true}) {
        await this.emitHook(hooks.onStatus, {
            phase: "thinking",
            message: "Composing final answer",
        });
        await this.pushWorkflowTrace(traces, hooks, {
            kind: "thinking",
            phase: "final",
            status: "composing",
            title: "Final response",
            label: "compose",
            outputPreview: "Converting collected notes and tool results into the assistant's final reply.",
        });
        const finalConversation = this.buildFinalAnswerConversation({
            userMessage,
            context,
            traces,
            plannerDraft,
        });
        const finalContent = await this.streamFinalAnswer(finalConversation, hooks);
        return {
            mode: "agent",
            content: finalContent || plannerDraft || "I do not have a usable result yet.",
            traces: thinkingMode ? traces : [],
        };
    }

    buildDirectContextText(context = []) {
        return context.length
            ? context.map((item) => `${item.role}: ${summarizeText(item.message, 120)}`).join("\n")
            : "没有最近对话上下文。";
    }

    buildDirectMemoryText(memories = []) {
        return memories.length
            ? memories.map((item, index) => `${index + 1}. ${item.title}: ${item.content}`).join("\n")
            : "没有长期记忆。";
    }

    async streamDirectAnswer({userMessage, context, memories, toolName = "", toolArgs = {}, toolResult = null}, hooks = {}) {
        const toolResultText = toolName
            ? `工具 ${toolName} 参数：${JSON.stringify(toolArgs)}\n工具 ${toolName} 结果：${JSON.stringify(toolResult)}`
            : "本次未调用工具。";
        const conversation = [
            {
                role: "system",
                content: [{
                    type: "text",
                    text: buildAgentDirectFinalPrompt({
                        contextText: this.buildDirectContextText(context),
                        memoryText: this.buildDirectMemoryText(memories),
                        toolResultText,
                    }),
                }],
            },
            {
                role: "user",
                content: [{
                    type: "text",
                    text: userMessage,
                }],
            },
        ];
        return await this.streamFinalAnswer(conversation, hooks);
    }

    async chatDirect(userMessage, hooks = {}, options = {}) {
        this.ensureNotAborted(hooks.signal);
        const context = this.getAssistantContext().slice(-8);
        const allowedTools = this.normalizeAllowedTools(options.allowedTools);
        const memories = this.getLongTermMemory().slice(-10).map((item) => ({
            title: item.title,
            content: summarizeText(item.content, 160),
        }));
        const plannerConversation = [
            {
                role: "system",
                content: [
                    {
                        type: "text",
                        text: buildAgentDirectToolPlannerPrompt({
                            userMessage,
                            contextText: this.buildDirectContextText(context),
                            memoryText: this.buildDirectMemoryText(memories),
                            allowedTools,
                        }),
                    },
                ],
            },
            {
                role: "user",
                content: [{type: "text", text: userMessage}],
            },
        ];
        const plannerModel = ENV_CONFIG.AI_SUMMARY_MODEL || ENV_CONFIG.AI_MODEL;
        const plannerTurn = await this.requestAgentTurn(plannerConversation, hooks, {
            enableThinking: false,
            temperature: 0,
            maxTokens: 512,
            model: plannerModel,
        });
        const plannerAction = this.parseAgentResponse(plannerTurn.content) || {type: "none"};
        let toolName = "";
        let toolArgs = {};
        let toolResult = null;

        if (plannerAction.type === "tool" && plannerAction.tool) {
            toolName = plannerAction.tool;
            toolArgs = normalizeToolArgs(plannerAction.args);
            try {
                toolResult = await this.runTool(toolName, toolArgs, allowedTools);
            } catch (error) {
                toolResult = {error: error?.message || String(error)};
            }
        }

        const finalContent = await this.streamDirectAnswer({
            userMessage,
            context,
            memories,
            toolName,
            toolArgs,
            toolResult,
        }, hooks);

        return {
            mode: "agent",
            content: String(finalContent || "").trim() || "我暂时没有生成可用回复。",
            traces: [],
        };
    }

    async chat(userMessage, hooks = {}, options = {}) {
        this.ensureNotAborted(hooks.signal);
        const traces = [];
        const planningConversation = [];
        const context = this.getAssistantContext().slice(-8);
        const allowedTools = this.normalizeAllowedTools(options.allowedTools);
        const directMode = options.directMode === true;
        if (directMode) {
            return await this.chatDirect(userMessage, hooks, options);
        }
        const memories = this.getLongTermMemory().slice(-10).map((item) => ({
            title: item.title,
            content: summarizeText(item.content, 160),
        }));

        planningConversation.push({
            role: "system",
            content: [
                {
                    type: "text",
                    text: this.buildAgentPlanningSystemPrompt(memories, context, allowedTools),
                },
            ],
        });
        planningConversation.push({
            role: "user",
            content: [{type: "text", text: userMessage}],
        });
        await this.emitHook(hooks.onStatus, {phase: "prefetch", message: "Preparing context"});
        const prefetchPlan = await this.planPrefetchTools(userMessage, context, hooks, allowedTools);
        await this.runPrefetchTools(userMessage, traces, planningConversation, {
            plan: prefetchPlan,
            allowedTools,
            onTrace: async (trace, nextTraces) => {
                await this.emitHook(hooks.onTrace, trace, [...nextTraces]);
            },
        });
        this.ensureNotAborted(hooks.signal);

        for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
            this.ensureNotAborted(hooks.signal);
            await this.emitHook(hooks.onStatus, {
                phase: "thinking",
                step: step + 1,
                message: `Thinking step ${step + 1}`,
            });
            const turn = await this.requestAgentTurn(planningConversation, hooks, {enableThinking: true});
            const content = turn.content;
            const action = this.parseAgentResponse(content);
            await this.pushWorkflowTrace(traces, hooks, this.createThinkingTrace(step, action));
            if (!action) {
                return await this.finalizeAgentResponse({
                    userMessage,
                    context,
                    traces,
                    hooks,
                    plannerDraft: content || "",
                    thinkingMode: true,
                });
            }
            if (action.type === "final") {
                return await this.finalizeAgentResponse({
                    userMessage,
                    context,
                    traces,
                    hooks,
                    plannerDraft: action.content || content || "",
                    thinkingMode: true,
                });
            }
            if (action.type !== "tool") {
                return await this.finalizeAgentResponse({
                    userMessage,
                    context,
                    traces,
                    hooks,
                    plannerDraft: content || "",
                    thinkingMode: true,
                });
            }

            const args = normalizeToolArgs(action.args);
            let toolResult;
            try {
                this.ensureNotAborted(hooks.signal);
                await this.emitHook(hooks.onStatus, {
                    phase: "tool",
                    step: step + 1,
                    tool: action.tool,
                    message: `Running ${action.tool}`,
                });
                toolResult = await this.runTool(action.tool, args, allowedTools);
                await this.pushWorkflowTrace(traces, hooks, {
                    tool: action.tool,
                    status: "success",
                    input: args,
                    outputPreview: clampTraceOutput(toolResult),
                });
            } catch (error) {
                toolResult = {
                    error: error?.message || String(error),
                };
                await this.pushWorkflowTrace(traces, hooks, {
                    tool: action.tool,
                    status: "error",
                    input: args,
                    outputPreview: clampTraceOutput(toolResult),
                });
            }
            this.ensureNotAborted(hooks.signal);

            planningConversation.push({
                role: "assistant",
                content: [{type: "text", text: JSON.stringify(action)}],
            });
            planningConversation.push({
                role: "user",
                content: [{
                    type: "text",
                    text: `Tool result for ${action.tool}: ${JSON.stringify(toolResult)}`,
                }],
            });
        }

        return await this.finalizeAgentResponse({
            userMessage,
            context,
            traces,
            hooks,
            plannerDraft: "",
            thinkingMode: true,
        });
    }

    async runCapabilitySelfTest(userMessage = "", hooks = {}) {
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
            {tool: "read_web_page", args: {url: "https://www.example.com"}},
        ];

        for (const item of suite) {
            try {
                this.ensureNotAborted(hooks.signal);
                await this.emitHook(hooks.onStatus, {
                    phase: "self-test",
                    tool: item.tool,
                    message: `Testing ${item.tool}`,
                });
                const output = await this.runTool(item.tool, item.args);
                const trace = {
                    tool: item.tool,
                    status: "success",
                    input: item.args,
                    outputPreview: clampTraceOutput(output),
                    phase: "self-test",
                };
                traces.push(trace);
                await this.emitHook(hooks.onTrace, trace, [...traces]);
                results.push(`- ${item.tool}: success`);
            } catch (error) {
                const trace = {
                    tool: item.tool,
                    status: "error",
                    input: item.args,
                    outputPreview: clampTraceOutput({error: error?.message || String(error)}),
                    phase: "self-test",
                };
                traces.push(trace);
                await this.emitHook(hooks.onTrace, trace, [...traces]);
                results.push(`- ${item.tool}: error - ${error?.message || String(error)}`);
            }
        }

        const successCount = traces.filter((item) => item.status === "success").length;
        const errorCount = traces.length - successCount;

        return {
            mode: "self-test",
            summary: {
                total: traces.length,
                successCount,
                errorCount,
            },
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
        const toolSpecs = this.getToolSpecs();
        return {
            visionEnabled: Boolean(ENV_CONFIG.AI_VISION_MODEL || ENV_CONFIG.VISION_MODEL),
            libraryRootCount: this.libraryRoots.length,
            libraryFileCount: this.libraryIndex.items.length,
            libraryChunkCount: chunkCount,
            libraryUpdatedAt: this.libraryIndex.updatedAt,
            tools: toolSpecs.map((item) => item.name),
            toolDetails: toolSpecs,
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

    async readWebPage(url) {
        return searchTools.readWebPage(this, url);
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

    async runPrefetchTools(userMessage, traces, conversation, options = {}) {
        return searchTools.runPrefetchTools(this, userMessage, traces, conversation, options);
    }


    async listScreenshots() {
        return visionTools.listScreenshots();
    }

    async analyzeClipboardImage(args = {}) {
        return visionTools.analyzeClipboardImage(this, args);
    }

    buildAgentPlanningSystemPrompt(memories, context, allowedTools = null, options = {}) {
        return searchTools.buildAgentPlanningSystemPrompt(memories, context, allowedTools, options);
    }

    async runTool(toolName, args, allowedTools = null) {
        this.ensureToolAllowed(toolName, allowedTools);
        return searchTools.runTool(this, toolName, args);
    }


    async webSearch(query) {
        return searchTools.webSearch(this, query);
    }
}

module.exports = {
    AgentService,
};
