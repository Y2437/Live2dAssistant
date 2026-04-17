const fs = require("fs/promises");
const {aiChatWithContent, aiChatWithContentStream} = require("./aiService");
const {
    AGENT_SCREENSHOT_DIR_PATH,
    ENV_CONFIG,
} = require("../config");
const {
    MAX_AGENT_STEPS,
    safeJsonParse,
    summarizeText,
    clampTraceOutput,
    normalizeToolArgs,
} = require("./agentShared");
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
        this.updateKnowledgeCard = options.updateKnowledgeCard;
        this.deleteKnowledgeCard = options.deleteKnowledgeCard;
        this.getPomodoroData = options.getPomodoroData;
        this.createPomodoroTask = options.createPomodoroTask;
        this.updatePomodoroTask = options.updatePomodoroTask;
        this.deletePomodoroTask = options.deletePomodoroTask;
        this.getCalendarDayDetail = options.getCalendarDayDetail;
        this.listCalendarTodos = options.listCalendarTodos;
        this.createCalendarTodo = options.createCalendarTodo;
        this.updateCalendarTodo = options.updateCalendarTodo;
        this.deleteCalendarTodo = options.deleteCalendarTodo;
        this.listAiDiaries = options.listAiDiaries;
        this.createAiDiary = options.createAiDiary;
        this.updateAiDiary = options.updateAiDiary;
        this.deleteAiDiary = options.deleteAiDiary;
        this.readAgentCallChain = options.getAgentCallChain;
        this.requestCameraCapture = options.requestCameraCapture;
        this.currentUserMessage = "";
    }

    async ensureReady() {
        await fs.mkdir(AGENT_SCREENSHOT_DIR_PATH, {recursive: true});
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

    resolveRunId(value = "") {
        const runId = String(value || "").trim();
        return runId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    formatContextItemWithTimestamp(item = {}, maxLength = 120) {
        const role = String(item?.role || "unknown");
        const createdAt = typeof item?.createdAt === "string" ? item.createdAt.trim() : "";
        const message = summarizeText(item?.message ?? item?.content ?? "", maxLength);
        const timestamp = createdAt ? `[${createdAt}] ` : "";
        return `${role}: ${timestamp}${message}`;
    }

    getLocalDateKey(value = new Date()) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "";
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    buildRunInfo({
        runId = "",
        startedAt = "",
        finishedAt = "",
        directMode = false,
        allowedTools = [],
        status = "success",
        error = "",
        traces = [],
        callChain = [],
    } = {}) {
        return {
            runId: this.resolveRunId(runId),
            startedAt: startedAt || new Date().toISOString(),
            finishedAt: finishedAt || new Date().toISOString(),
            directMode: directMode === true,
            allowedTools: Array.isArray(allowedTools) ? [...allowedTools] : [],
            status,
            error: String(error || ""),
            traceCount: Array.isArray(traces) ? traces.length : 0,
            traces: Array.isArray(traces) ? traces : [],
            callChain: Array.isArray(callChain) ? callChain : [],
        };
    }

    attachRunInfo(result = {}, runInfo = {}) {
        return {
            ...result,
            runId: runInfo.runId || "",
            run: runInfo,
        };
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
        const allowedSet = allowedTools instanceof Set
            ? allowedTools
            : new Set(this.normalizeAllowedTools(allowedTools));
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
                            ? context.map((item) => this.formatContextItemWithTimestamp(item, 120)).join("\n")
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
            ? context.map((item) => this.formatContextItemWithTimestamp(item, 120)).join("\n")
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
        this.currentUserMessage = String(userMessage || "");
        const runId = this.resolveRunId(options.runId);
        const runStartedAt = new Date().toISOString();
        const context = this.getAssistantContext().slice(-8);
        const allowedTools = this.normalizeAllowedTools(options.allowedTools);
        const allowedToolSet = new Set(allowedTools);
        const memories = this.getLongTermMemory().slice(-10).map((item) => ({
            title: item.title,
            content: summarizeText(item.content, 160),
        }));
        const callChain = [];
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
        callChain.push({
            phase: "direct-planner",
            status: "done",
            output: plannerAction,
        });
        let toolName = "";
        let toolArgs = {};
        let toolResult = null;

        if (plannerAction.type === "tool" && plannerAction.tool) {
            toolName = plannerAction.tool;
            toolArgs = normalizeToolArgs(plannerAction.args);
            try {
                toolResult = await this.runTool(toolName, toolArgs, allowedToolSet);
                callChain.push({
                    phase: "direct-tool",
                    tool: toolName,
                    status: "success",
                    input: toolArgs,
                    output: toolResult,
                });
            } catch (error) {
                toolResult = {error: error?.message || String(error)};
                callChain.push({
                    phase: "direct-tool",
                    tool: toolName,
                    status: "error",
                    input: toolArgs,
                    output: toolResult,
                });
            }
        }

        try {
            const finalContent = await this.streamDirectAnswer({
                userMessage,
                context,
                memories,
                toolName,
                toolArgs,
                toolResult,
            }, hooks);

            return {
                ...this.attachRunInfo({
                    mode: "agent",
                    content: String(finalContent || "").trim() || "我暂时没有生成可用回复。",
                    traces: [],
                }, this.buildRunInfo({
                    runId,
                    startedAt: runStartedAt,
                    finishedAt: new Date().toISOString(),
                    directMode: true,
                    allowedTools,
                    status: "success",
                    traces: [],
                    callChain,
                })),
            };
        } catch (error) {
            error.run = this.buildRunInfo({
                runId,
                startedAt: runStartedAt,
                finishedAt: new Date().toISOString(),
                directMode: true,
                allowedTools,
                status: "error",
                error: error?.message || String(error),
                traces: [],
                callChain,
            });
            throw error;
        } finally {
            this.currentUserMessage = "";
        }
    }

    async chat(userMessage, hooks = {}, options = {}) {
        this.ensureNotAborted(hooks.signal);
        this.currentUserMessage = String(userMessage || "");
        const runId = this.resolveRunId(options.runId);
        const runStartedAt = new Date().toISOString();
        const traces = [];
        const callChain = [];
        const planningConversation = [];
        const context = this.getAssistantContext().slice(-8);
        const allowedTools = this.normalizeAllowedTools(options.allowedTools);
        const allowedToolSet = new Set(allowedTools);
        const directMode = options.directMode === true;
        try {
            if (directMode) {
                return await this.chatDirect(userMessage, hooks, {...options, runId});
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
                allowedTools: allowedToolSet,
                onTrace: async (trace, nextTraces) => {
                    callChain.push({
                        phase: trace?.phase || "prefetch",
                        tool: trace?.tool || "",
                        status: trace?.status || "done",
                        input: trace?.input || {},
                        output: trace?.output || null,
                    });
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
                callChain.push({
                    phase: "thinking",
                    step: step + 1,
                    status: action?.type || "draft",
                    output: action || {type: "draft", content},
                });
                await this.pushWorkflowTrace(traces, hooks, this.createThinkingTrace(step, action));
                if (!action) {
                    const result = await this.finalizeAgentResponse({
                        userMessage,
                        context,
                        traces,
                        hooks,
                        plannerDraft: content || "",
                        thinkingMode: true,
                    });
                    return this.attachRunInfo(result, this.buildRunInfo({
                        runId,
                        startedAt: runStartedAt,
                        finishedAt: new Date().toISOString(),
                        directMode: false,
                        allowedTools,
                        status: "success",
                        traces: result.traces,
                        callChain,
                    }));
                }
                if (action.type === "final") {
                    const result = await this.finalizeAgentResponse({
                        userMessage,
                        context,
                        traces,
                        hooks,
                        plannerDraft: action.content || content || "",
                        thinkingMode: true,
                    });
                    return this.attachRunInfo(result, this.buildRunInfo({
                        runId,
                        startedAt: runStartedAt,
                        finishedAt: new Date().toISOString(),
                        directMode: false,
                        allowedTools,
                        status: "success",
                        traces: result.traces,
                        callChain,
                    }));
                }
                if (action.type !== "tool") {
                    const result = await this.finalizeAgentResponse({
                        userMessage,
                        context,
                        traces,
                        hooks,
                        plannerDraft: content || "",
                        thinkingMode: true,
                    });
                    return this.attachRunInfo(result, this.buildRunInfo({
                        runId,
                        startedAt: runStartedAt,
                        finishedAt: new Date().toISOString(),
                        directMode: false,
                        allowedTools,
                        status: "success",
                        traces: result.traces,
                        callChain,
                    }));
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
                    toolResult = await this.runTool(action.tool, args, allowedToolSet);
                    const successTrace = {
                        tool: action.tool,
                        status: "success",
                        input: args,
                        output: toolResult,
                        outputPreview: clampTraceOutput(toolResult),
                    };
                    await this.pushWorkflowTrace(traces, hooks, successTrace);
                    callChain.push({
                        phase: "tool",
                        step: step + 1,
                        tool: action.tool,
                        status: "success",
                        input: args,
                        output: toolResult,
                    });
                } catch (error) {
                    toolResult = {
                        error: error?.message || String(error),
                    };
                    const errorTrace = {
                        tool: action.tool,
                        status: "error",
                        input: args,
                        output: toolResult,
                        outputPreview: clampTraceOutput(toolResult),
                    };
                    await this.pushWorkflowTrace(traces, hooks, errorTrace);
                    callChain.push({
                        phase: "tool",
                        step: step + 1,
                        tool: action.tool,
                        status: "error",
                        input: args,
                        output: toolResult,
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

            const result = await this.finalizeAgentResponse({
                userMessage,
                context,
                traces,
                hooks,
                plannerDraft: "",
                thinkingMode: true,
            });
            return this.attachRunInfo(result, this.buildRunInfo({
                runId,
                startedAt: runStartedAt,
                finishedAt: new Date().toISOString(),
                directMode: false,
                allowedTools,
                status: "success",
                traces: result.traces,
                callChain,
            }));
        } catch (error) {
            if (!error.run) {
                error.run = this.buildRunInfo({
                    runId,
                    startedAt: runStartedAt,
                    finishedAt: new Date().toISOString(),
                    directMode,
                    allowedTools,
                    status: "error",
                    error: error?.message || String(error),
                    traces,
                    callChain,
                });
            }
            throw error;
        } finally {
            this.currentUserMessage = "";
        }
    }

    async runCapabilitySelfTest(userMessage = "", hooks = {}) {
        const traces = [];
        const results = [];
        const suite = [
            {tool: "get_agent_call_chain", args: {allowEmpty: true}},
            {tool: "get_memory", args: {}},
            {tool: "search_memory", args: {query: userMessage}},
            {tool: "get_memory_routine_status", args: {}},
            {tool: "list_cards", args: {}},
            {tool: "list_card_categories", args: {}},
            {tool: "search_cards", args: {query: userMessage}},
            {tool: "list_pomodoro_tasks", args: {}},
            {tool: "get_calendar_day_plan", args: {date: new Date().toISOString().slice(0, 10)}},
            {tool: "list_calendar_todos", args: {}},
            {tool: "list_todo_items", args: {}},
            {tool: "list_ai_diaries", args: {}},
            {tool: "get_clipboard", args: {}},
            {tool: "list_screenshots", args: {}},
            {tool: "get_pomodoro_status", args: {}},
            {tool: "web_search", args: {query: userMessage}},
            {tool: "read_web_page", args: {url: "http://example.com"}},
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
                    output,
                    outputPreview: clampTraceOutput(output),
                    phase: "self-test",
                };
                traces.push(trace);
                await this.emitHook(hooks.onTrace, trace, [...traces]);
                results.push(`- ${item.tool}: success`);
            } catch (error) {
                const errorPayload = {error: error?.message || String(error)};
                const trace = {
                    tool: item.tool,
                    status: "error",
                    input: item.args,
                    output: errorPayload,
                    outputPreview: clampTraceOutput(errorPayload),
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
                "Skipped state-changing or environment-dependent tools: add_memory, delete_memory, extract_memory, create_card, update_card, delete_card, create_pomodoro_task, update_pomodoro_task, delete_pomodoro_task, create_calendar_todo, update_calendar_todo, delete_calendar_todo, create_todo_item, update_todo_item, delete_todo_item, create_ai_diary, update_ai_diary, delete_ai_diary, capture_screen, analyze_clipboard_image, analyze_image, get_card.",
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

    getCurrentTime() {
        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        const offsetMinutes = -now.getTimezoneOffset();
        const offsetSign = offsetMinutes >= 0 ? "+" : "-";
        const absMinutes = Math.abs(offsetMinutes);
        const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
        const offsetRemainderMinutes = String(absMinutes % 60).padStart(2, "0");
        const utcOffset = `${offsetSign}${offsetHours}:${offsetRemainderMinutes}`;
        const localDateTime = new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(now);

        return {
            timestamp: now.getTime(),
            iso: now.toISOString(),
            localDateTime,
            date: localDateTime.slice(0, 10),
            time: localDateTime.slice(12),
            timezone,
            utcOffset,
        };
    }

    canGenerateTodayDiaryFromCurrentRequest() {
        const source = String(this.currentUserMessage || "").trim().toLowerCase();
        if (!source) {
            return false;
        }
        const hasDiary = /ai日记|日记|diary/i.test(source);
        const hasCreateIntent = /(生成|写|创建|记录|produce|write|create|generate)/i.test(source);
        const hasUnsupportedDateTarget = /(昨天|昨日|前天|明天|后天|tomorrow|yesterday)/i.test(source);
        return hasDiary && hasCreateIntent && !hasUnsupportedDateTarget;
    }

    async generateTodayAiDiary(args = {}) {
        if (!this.canGenerateTodayDiaryFromCurrentRequest()) {
            throw new Error("Only explicit requests to generate AI diary for today are allowed.");
        }
        return await this.createAiDiary({
            date: this.getLocalDateKey(new Date()),
            prompt: typeof args?.prompt === "string" ? args.prompt : "",
            autoGenerate: true,
            source: "agent",
            restrictToTodayContext: true,
            dedupeByDate: true,
        });
    }


    searchMemory(query) {
        return searchTools.searchMemory(this, query);
    }

    async getAgentCallChain(args = {}) {
        if (typeof this.readAgentCallChain !== "function") {
            throw new Error("Agent call chain store is not available.");
        }
        return await this.readAgentCallChain(args);
    }

    getCapabilities() {
        const toolSpecs = this.getToolSpecs();
        return {
            visionEnabled: Boolean(ENV_CONFIG.AI_VISION_MODEL || ENV_CONFIG.VISION_MODEL),
            tools: toolSpecs.map((item) => item.name),
            toolDetails: toolSpecs,
        };
    }

    async readWebPage(url) {
        return searchTools.readWebPage(this, url);
    }


    async captureScreen(name) {
        return visionTools.captureScreen(name);
    }

    async captureCameraPhoto(name) {
        if (typeof this.requestCameraCapture !== "function") {
            throw new Error("Camera capture is not available.");
        }
        const payload = await this.requestCameraCapture(name);
        return visionTools.saveCameraCapture({
            dataUrl: payload?.dataUrl,
            name,
        });
    }

    async analyzeImage(args) {
        return visionTools.analyzeImage(args);
    }

    listCards(category) {
        return searchTools.listCards(this, category);
    }

    listCardCategories() {
        return searchTools.listCardCategories(this);
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

    async listPomodoroTasks() {
        const tasks = await this.getPomodoroData();
        return {
            count: tasks.length,
            items: tasks.slice(0, 48).map((item) => ({
                id: item.id,
                title: item.title,
                workMinutes: Math.round((Number(item.workTime) || 0) / 60000),
                restMinutes: Math.round((Number(item.restTime) || 0) / 60000),
                repeatTimes: Number(item.repeatTimes) || 0,
            })),
        };
    }
}

module.exports = {
    AgentService,
};
