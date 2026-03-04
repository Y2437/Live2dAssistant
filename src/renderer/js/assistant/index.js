import { CONFIG } from "../core/config.js";
import { marked } from "../../vendor/marked/lib/marked.esm.js";
import { $ } from "../shared/dom.js";

const dom = {
    root: $(".assistant-root"),
    stage: $('[data-role="assistant-live2d-stage"]'),
    bubble: $('[data-role="assistant-bubble"]'),
    bubbleLabel: $('[data-role="assistant-bubble-label"]'),
    bubbleBody: $('[data-role="assistant-bubble-body"]'),
    bubbleExpand: $('[data-role="assistant-expand"]'),
    chatLog: $('[data-role="assistant-chat-log"]'),
    chatMode: $('[data-role="assistant-chat-mode"]'),
    scrollBottom: $('[data-role="assistant-scroll-bottom"]'),
    collapse: $('[data-role="assistant-collapse"]'),
    inputForm: $("form.assistant-form"),
    scope: $('[data-role="assistant-scope"]'),
    scopeTrigger: $('[data-role="assistant-scope-trigger"]'),
    scopeSummary: $('[data-role="assistant-scope-summary"]'),
    scopeMenu: $('[data-role="assistant-scope-menu"]'),
    scopeList: $('[data-role="assistant-scope-list"]'),
    scopeSelectAll: $('[data-role="assistant-scope-select-all"]'),
    scopeClear: $('[data-role="assistant-scope-clear"]'),
    input: $('[data-role="assistant-input"]'),
    send: $('[data-role="assistant-send"]'),
    cancel: $('[data-role="assistant-cancel"]'),
    retry: $('[data-role="assistant-retry"]'),
    navPanel: $('[data-role="assistant-actions"]'),
    runPanel: $('[data-role="assistant-run-panel"]'),
    runStatus: $('[data-role="assistant-run-status"]'),
    runSummary: $('[data-role="assistant-run-summary"]'),
    runToggle: $('[data-role="assistant-run-toggle"]'),
    runBody: $('[data-role="assistant-run-body"]'),
    runTimeline: $('[data-role="assistant-run-timeline"]'),
};

const assistantState = {
    mounted: false,
    pixiApp: null,
    live2d: null,
    resizeObserver: null,
    baseHeight: null,
    baseWidth: null,
    queue: Promise.resolve(),
    expanded: false,
    lastBubbleType: "chat",
    touchTimer: null,
    shouldStickToBottom: true,
    activeRequest: null,
    requestTimeoutId: null,
    lastRetryText: "",
    lastRetryAllowedTools: null,
    runtimeStatus: null,
    runtimeTraces: [],
    runPanelExpanded: false,
    alwaysAllowedTools: [],
    availableTools: [],
    selectedTools: [],
    scopeOpen: false,
};

const TIMEOUT_MS = CONFIG.LIVE2D_CONFIG.TIMEOUT_MS;
const WIDTH_FALLBACK = CONFIG.LIVE2D_CONFIG.WIDTH;
const HEIGHT_FALLBACK = CONFIG.LIVE2D_CONFIG.HEIGHT;
const AUTO_EXPAND_LENGTH = CONFIG.LIVE2D_CONFIG.AUTO_EXPAND_LENGTH;
const AUTO_EXPAND_LINES = CONFIG.LIVE2D_CONFIG.AUTO_EXPAND_LINES;
const REQUEST_TIMEOUT_MS = CONFIG.ASSISTANT_CONFIG.REQUEST_TIMEOUT_MS;
const NEAR_BOTTOM_OFFSET = CONFIG.ASSISTANT_CONFIG.NEAR_BOTTOM_OFFSET;
const SPECIAL_AGENT_TOOL_NAMES = new Set([
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
    "read_web_page",
    "capture_screen",
    "list_screenshots",
    "analyze_image",
]);
const SPECIAL_AGENT_CATEGORY_LABELS = {
    cards: "知识卡片",
    pomodoro: "番茄钟",
    clipboard: "剪贴板",
    library: "资料库",
    web: "联网",
    vision: "视觉",
};
const AGENT_SCOPE_STORAGE_KEY = "assistant.agentScope.specialTools.v1";

function dispatchNavigate(viewKey) {
    window.dispatchEvent(new CustomEvent("shell:navigate", { detail: { viewKey } }));
}

function ensureBubbleMarkup() {
    if (!dom.bubble || dom.bubbleBody) return;
    dom.bubble.innerHTML = `
        <div class="assistant-bubble__head">
            <span class="assistant-bubble__label" data-role="assistant-bubble-label">${CONFIG.ASSISTANT_CONFIG.BUBBLE_LABEL_RESPONSE}</span>
            <button type="button" class="assistant-bubble__expand" data-role="assistant-expand" aria-label="${CONFIG.ASSISTANT_CONFIG.BUBBLE_EXPAND_ARIA_LABEL}" hidden>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2"/>
                </svg>
            </button>
        </div>
        <div class="assistant-bubble__body" data-role="assistant-bubble-body"></div>
    `;
    dom.bubbleLabel = $('[data-role="assistant-bubble-label"]');
    dom.bubbleBody = $('[data-role="assistant-bubble-body"]');
    dom.bubbleExpand = $('[data-role="assistant-expand"]');
}

function setLayout(expanded) {
    assistantState.expanded = expanded;
    if (dom.root) {
        dom.root.dataset.assistantLayout = expanded ? "expanded" : "compact";
    }
    if (dom.chatMode) {
        dom.chatMode.textContent = expanded ? CONFIG.ASSISTANT_CONFIG.CHAT_MODE_EXPANDED : CONFIG.ASSISTANT_CONFIG.CHAT_MODE_COMPACT;
    }
    if (expanded && assistantState.lastBubbleType === "chat") {
        toggleBubbleVisibility(false);
    } else if (!expanded && assistantState.lastBubbleType === "chat") {
        toggleBubbleVisibility(true);
    }
    if (dom.scrollBottom) {
        dom.scrollBottom.hidden = !expanded || isNearBottom();
    }
}

function mountAssistant() {
    if (assistantState.mounted || !dom.root) return;
    assistantState.mounted = true;
    ensureBubbleMarkup();
    setLayout(false);
    syncRequestControls();
    syncRunPanel();
}

function initPixiApp() {
    const width = dom.stage.clientWidth || WIDTH_FALLBACK;
    const height = dom.stage.clientHeight || HEIGHT_FALLBACK;
    const app = new window.PIXI.Application({
        width,
        height,
        antialias: true,
        backgroundAlpha: 0,
    });
    assistantState.pixiApp = app;
    dom.stage.appendChild(app.view);
}

async function initLive2d() {
    const live2dUrl = new URL(CONFIG.LIVE2D_CONFIG.model.jsonFile, window.location.href).href;
    const live2d = await window.PIXI.live2d.Live2DModel.from(live2dUrl);
    live2d.scale.set(1);
    assistantState.baseHeight = live2d.height;
    assistantState.baseWidth = live2d.width;
    assistantState.live2d = live2d;
    assistantState.pixiApp.stage.addChild(live2d);
}

function placeLive2d() {
    const width = dom.stage.clientWidth;
    const height = dom.stage.clientHeight;
    if (!width || !height || !assistantState.live2d) return;

    assistantState.pixiApp.renderer.resize(width, height);
    assistantState.live2d.pivot.set(assistantState.baseWidth / 2, assistantState.baseHeight / 2);
    const scale = Math.min(width / assistantState.baseWidth, height / assistantState.baseHeight) * 1.06;
    assistantState.live2d.scale.set(scale);
    assistantState.live2d.position.set(width / 2, height * 0.92);
}

function initResizeObserver() {
    assistantState.resizeObserver = new ResizeObserver(() => {
        placeLive2d();
    });
    assistantState.resizeObserver.observe(dom.stage);
}

function toggleBubbleVisibility(setVisibility) {
    if (!dom.bubble) return;
    if (setVisibility) {
        dom.bubble.classList.remove("is-hiding");
        dom.bubble.classList.add("is-visible");
        return;
    }
    if (!dom.bubble.classList.contains("is-visible")) return;
    dom.bubble.classList.add("is-hiding");
    const onEnd = (event) => {
        if (event.target !== dom.bubble || event.propertyName !== "opacity") return;
        dom.bubble.classList.remove("is-visible");
        dom.bubble.classList.remove("is-hiding");
        dom.bubble.removeEventListener("transitionend", onEnd);
    };
    dom.bubble.addEventListener("transitionend", onEnd);
}

function renderMarkdown(target, text) {
    target.innerHTML = marked.parse(text || "");
}

function isNearBottom() {
    if (!dom.chatLog) return true;
    const distance = dom.chatLog.scrollHeight - dom.chatLog.scrollTop - dom.chatLog.clientHeight;
    return distance < NEAR_BOTTOM_OFFSET;
}

function updateScrollBottomButton() {
    if (!dom.scrollBottom || !dom.chatLog || !assistantState.expanded) return;
    dom.scrollBottom.hidden = isNearBottom();
}

function scrollChatToBottom(force = false) {
    if (!dom.chatLog) return;
    if (!force && !assistantState.shouldStickToBottom) {
        updateScrollBottomButton();
        return;
    }
    dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
    updateScrollBottomButton();
}

function updateBubbleExpandButton(type, text = "") {
    if (!dom.bubbleExpand) return;
    const shouldShow = !assistantState.expanded && type === "chat" && shouldExpandForChat(text);
    dom.bubbleExpand.hidden = !shouldShow;
}

function shouldExpandForChat(text = "", traces = []) {
    const value = String(text || "");
    const lineCount = value.split(/\r?\n/).length;
    return value.trim().length >= AUTO_EXPAND_LENGTH || lineCount >= AUTO_EXPAND_LINES || (Array.isArray(traces) && traces.length >= 2);
}

function renderBubble(text, type = "chat") {
    if (!dom.bubble) return;
    assistantState.lastBubbleType = type;
    if (dom.bubbleLabel) {
        dom.bubbleLabel.textContent = type === "touch"
            ? CONFIG.ASSISTANT_CONFIG.BUBBLE_LABEL_TOUCH
            : CONFIG.ASSISTANT_CONFIG.BUBBLE_LABEL_RESPONSE;
    }
    dom.bubble.classList.remove("is-updating");
    void dom.bubble.offsetWidth;
    dom.bubble.classList.add("is-updating");
    renderMarkdown(dom.bubbleBody || dom.bubble, text);
    if (dom.bubbleBody) {
        dom.bubbleBody.scrollTop = dom.bubbleBody.scrollHeight;
    }
    updateBubbleExpandButton(type, text);
    toggleBubbleVisibility(true);
}

function makeChatEntry(role, initialText = "", status = "") {
    if (!dom.chatLog) {
        return {
            content: document.createElement("div"),
            status: { textContent: "" },
        };
    }
    const entry = document.createElement("article");
    entry.className = "assistant-chatEntry";
    entry.innerHTML = `
        <div class="assistant-chatEntry__meta">
            <span class="assistant-chatEntry__role">${role}</span>
            <span class="assistant-chatEntry__status">${status}</span>
        </div>
        <div class="assistant-chatEntry__content"></div>
    `;
    const content = $(".assistant-chatEntry__content", entry);
    renderMarkdown(content, initialText);
    dom.chatLog.appendChild(entry);
    scrollChatToBottom();
    return {
        content,
        status: $(".assistant-chatEntry__status", entry),
    };
}

function setChatStatus(entryHandle, statusText) {
    if (entryHandle?.status) {
        entryHandle.status.textContent = statusText;
    }
}

function formatRuntimeStatus(status) {
    if (!status || typeof status !== "object") {
        return CONFIG.ASSISTANT_CONFIG.STATUS_STREAMING;
    }
    const stepText = status.step ? ` ${CONFIG.ASSISTANT_CONFIG.STATUS_STEP_SUFFIX} ${status.step}` : "";
    if (status.phase === "prefetch") {
        return CONFIG.ASSISTANT_CONFIG.STATUS_PHASE_PREFETCH;
    }
    if (status.phase === "thinking") {
        return `${CONFIG.ASSISTANT_CONFIG.STATUS_PHASE_THINKING}${stepText}`;
    }
    if (status.phase === "tool") {
        const toolName = status.tool || status.message || CONFIG.ASSISTANT_CONFIG.STATUS_PHASE_TOOL;
        return `${CONFIG.ASSISTANT_CONFIG.STATUS_TOOL_PREFIX}: ${toolName}`;
    }
    return status.message || CONFIG.ASSISTANT_CONFIG.STATUS_STREAMING;
}

function buildRunSummary() {
    const status = assistantState.runtimeStatus;
    const traces = assistantState.runtimeTraces || [];
    if (!status && !traces.length) {
        return CONFIG.ASSISTANT_CONFIG.RUN_PANEL_SUMMARY_IDLE;
    }
    if (status?.phase === "prefetch") {
        return "正在整理上下文和现有信息。";
    }
    if (status?.phase === "thinking") {
        const stepText = status.step ? `第 ${status.step} 步` : "当前";
        return `${stepText}正在思考如何回答。已记录 ${traces.length} 个过程节点。`;
    }
    if (status?.phase === "tool") {
        const toolName = status.tool || "工具";
        return `正在调用 ${toolName}。已完成 ${traces.length} 个过程节点。`;
    }
    if (status?.message === CONFIG.ASSISTANT_CONFIG.STATUS_DONE) {
        return traces.length ? `回答已完成，共记录 ${traces.length} 个过程节点。` : "回答已完成，没有额外工具调用。";
    }
    if (status?.message === CONFIG.ASSISTANT_CONFIG.STATUS_CANCELED) {
        return `本次请求已取消，保留了 ${traces.length} 个已完成节点。`;
    }
    if (status?.message === CONFIG.ASSISTANT_CONFIG.STATUS_TIMEOUT) {
        return `本次请求已超时，保留了 ${traces.length} 个已完成节点。`;
    }
    if (status?.message === CONFIG.ASSISTANT_CONFIG.STATUS_ERROR) {
        return `本次请求失败，保留了 ${traces.length} 个已完成节点。`;
    }
    if (traces.length) {
        const lastTrace = traces[traces.length - 1];
        return `最近一步是 ${lastTrace.tool || CONFIG.ASSISTANT_CONFIG.TRACE_DEFAULT_TOOL}，共 ${traces.length} 步。`;
    }
    return CONFIG.ASSISTANT_CONFIG.RUN_PANEL_SUMMARY_IDLE;
}

function clearRequestTimeout() {
    if (assistantState.requestTimeoutId) {
        clearTimeout(assistantState.requestTimeoutId);
        assistantState.requestTimeoutId = null;
    }
}

function scheduleRequestTimeout(onTimeout) {
    clearRequestTimeout();
    assistantState.requestTimeoutId = setTimeout(() => {
        onTimeout();
    }, REQUEST_TIMEOUT_MS);
}

function resetRuntimeState() {
    assistantState.runtimeStatus = null;
    assistantState.runtimeTraces = [];
    assistantState.runPanelExpanded = false;
    syncRunPanel();
}

function setRuntimeStatus(status) {
    assistantState.runtimeStatus = status || null;
    syncRunPanel();
}

function setRuntimeTraces(traces) {
    assistantState.runtimeTraces = Array.isArray(traces) ? traces : [];
    syncRunPanel();
}

function createRunStepCard({title, badge, pills = [], preview = ""}) {
    const article = document.createElement("article");
    article.className = "assistant-runStep";

    const head = document.createElement("div");
    head.className = "assistant-runStep__head";

    const titleNode = document.createElement("span");
    titleNode.className = "assistant-runStep__title";
    titleNode.textContent = title;
    head.appendChild(titleNode);

    const badgeNode = document.createElement("span");
    badgeNode.className = "assistant-runStep__badge";
    badgeNode.textContent = badge;
    head.appendChild(badgeNode);

    article.appendChild(head);

    if (pills.length) {
        const meta = document.createElement("div");
        meta.className = "assistant-runStep__meta";
        for (const pill of pills) {
            const pillNode = document.createElement("span");
            pillNode.className = "assistant-runStep__pill";
            pillNode.textContent = pill;
            meta.appendChild(pillNode);
        }
        article.appendChild(meta);
    }

    const previewNode = document.createElement("p");
    previewNode.className = "assistant-runStep__preview";
    previewNode.textContent = preview || CONFIG.ASSISTANT_CONFIG.RUN_PANEL_EMPTY;
    article.appendChild(previewNode);
    return article;
}

function syncRunPanel() {
    if (!dom.runPanel || !dom.runTimeline || !dom.runStatus || !dom.runSummary || !dom.runToggle || !dom.runBody) return;
    const hasStatus = Boolean(assistantState.runtimeStatus);
    const traces = assistantState.runtimeTraces || [];
    const hasData = hasStatus || traces.length > 0;
    dom.runPanel.hidden = !hasData;
    dom.runStatus.textContent = hasStatus
        ? formatRuntimeStatus(assistantState.runtimeStatus)
        : CONFIG.ASSISTANT_CONFIG.RUN_PANEL_IDLE;
    dom.runSummary.textContent = buildRunSummary();
    dom.runToggle.hidden = traces.length === 0;
    dom.runToggle.textContent = assistantState.runPanelExpanded
        ? CONFIG.ASSISTANT_CONFIG.RUN_PANEL_TOGGLE_COLLAPSE
        : CONFIG.ASSISTANT_CONFIG.RUN_PANEL_TOGGLE_EXPAND;
    dom.runBody.hidden = !assistantState.runPanelExpanded;
    dom.runTimeline.innerHTML = "";

    if (!assistantState.runPanelExpanded) {
        return;
    }

    traces.forEach((trace, index) => {
        const pills = [];
        if (trace.kind) pills.push(`kind: ${trace.kind}`);
        if (trace.phase) pills.push(`phase: ${trace.phase}`);
        if (trace.status) pills.push(`status: ${trace.status}`);
        dom.runTimeline.appendChild(createRunStepCard({
            title: trace.title || `${CONFIG.ASSISTANT_CONFIG.TRACE_STEP_LABEL} ${index + 1}`,
            badge: trace.label || trace.tool || CONFIG.ASSISTANT_CONFIG.TRACE_DEFAULT_TOOL,
            pills,
            preview: trace.outputPreview || CONFIG.ASSISTANT_CONFIG.RUN_PANEL_EMPTY,
        }));
    });
}

function syncRequestControls() {
    const busy = Boolean(assistantState.activeRequest);
    const retryable = Boolean(assistantState.lastRetryText);
    if (dom.send) {
        dom.send.disabled = busy;
        dom.send.textContent = CONFIG.ASSISTANT_CONFIG.REQUEST_SEND_LABEL;
    }
    if (dom.cancel) {
        dom.cancel.hidden = !busy;
        dom.cancel.disabled = !busy;
        dom.cancel.textContent = CONFIG.ASSISTANT_CONFIG.REQUEST_CANCEL_LABEL;
    }
    if (dom.retry) {
        dom.retry.hidden = busy || !retryable;
        dom.retry.disabled = busy || !retryable;
        dom.retry.textContent = CONFIG.ASSISTANT_CONFIG.REQUEST_RETRY_LABEL;
    }
    if (dom.input) {
        dom.input.disabled = busy;
    }
    if (dom.scopeTrigger) {
        dom.scopeTrigger.disabled = busy;
    }
    if (dom.scopeSelectAll) {
        dom.scopeSelectAll.disabled = busy;
    }
    if (dom.scopeClear) {
        dom.scopeClear.disabled = busy;
    }
}

function getAllowedToolsForRequest() {
    return [...assistantState.alwaysAllowedTools, ...assistantState.selectedTools];
}

function saveScopeSelection() {
    try {
        window.localStorage.setItem(AGENT_SCOPE_STORAGE_KEY, JSON.stringify(assistantState.selectedTools));
    } catch (error) {
        console.error(error);
    }
}

function loadScopeSelection() {
    try {
        const raw = window.localStorage.getItem(AGENT_SCOPE_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : null;
    } catch (error) {
        console.error(error);
        return null;
    }
}

function setScopeOpen(open) {
    assistantState.scopeOpen = Boolean(open);
    if (dom.scopeMenu) {
        dom.scopeMenu.hidden = !assistantState.scopeOpen;
    }
    if (dom.scopeTrigger) {
        dom.scopeTrigger.setAttribute("aria-expanded", assistantState.scopeOpen ? "true" : "false");
    }
}

function buildScopeSummary() {
    const total = assistantState.availableTools.length;
    const selectedCount = assistantState.selectedTools.length;
    if (!total) {
        return "仅基础能力";
    }
    if (selectedCount === total) {
        return "全部扩展能力";
    }
    if (selectedCount === 0) {
        return "仅基础能力";
    }
    if (selectedCount <= 2) {
        return assistantState.selectedTools
            .map((toolName) => assistantState.availableTools.find((item) => item.name === toolName)?.label || toolName)
            .join("、");
    }
    return `已选 ${selectedCount} 项能力`;
}

function syncScopeSummary() {
    if (dom.scopeSummary) {
        dom.scopeSummary.textContent = buildScopeSummary();
    }
}

function renderScopeToolOptions() {
    if (!dom.scopeList) {
        return;
    }
    dom.scopeList.innerHTML = "";
    assistantState.availableTools.forEach((tool) => {
        const option = document.createElement("label");
        option.className = "assistant-scope__option";
        const categoryLabel = SPECIAL_AGENT_CATEGORY_LABELS[tool.category] || "扩展";
        option.innerHTML = `
            <input type="checkbox" class="assistant-scope__checkbox" value="${tool.name}">
            <span class="assistant-scope__checkmark" aria-hidden="true"></span>
            <span class="assistant-scope__optionBody">
                <span class="assistant-scope__optionMeta">
                    <span class="assistant-scope__optionTitle">${tool.label || tool.name}</span>
                    <span class="assistant-scope__optionBadge">${categoryLabel}</span>
                </span>
                <span class="assistant-scope__optionDesc">${tool.description || tool.name}</span>
            </span>
        `;
        const checkbox = $('input[type="checkbox"]', option);
        checkbox.checked = assistantState.selectedTools.includes(tool.name);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                assistantState.selectedTools = assistantState.selectedTools.includes(tool.name)
                    ? assistantState.selectedTools
                    : [...assistantState.selectedTools, tool.name];
            } else {
                assistantState.selectedTools = assistantState.selectedTools.filter((item) => item !== tool.name);
            }
            saveScopeSelection();
            syncScopeSummary();
        });
        dom.scopeList.appendChild(option);
    });
}

async function loadAgentCapabilities() {
    if (!window.api.getAgentCapabilities || !dom.scope) {
        return;
    }
    try {
        const capabilities = await window.api.getAgentCapabilities();
        const toolDetails = Array.isArray(capabilities?.toolDetails)
            ? capabilities.toolDetails
            : (capabilities?.tools || []).map((name) => ({name, label: name, description: name}));
        assistantState.alwaysAllowedTools = toolDetails
            .filter((item) => !SPECIAL_AGENT_TOOL_NAMES.has(item.name))
            .map((item) => item.name);
        const specialTools = toolDetails.filter((item) => SPECIAL_AGENT_TOOL_NAMES.has(item.name));
        if (!specialTools.length) {
            dom.scope.hidden = true;
            return;
        }
        assistantState.availableTools = specialTools;
        const savedSelection = loadScopeSelection();
        const validToolNames = new Set(specialTools.map((item) => item.name));
        assistantState.selectedTools = Array.isArray(savedSelection)
            ? savedSelection.filter((item) => validToolNames.has(item))
            : specialTools.map((item) => item.name);
        renderScopeToolOptions();
        syncScopeSummary();
    } catch (error) {
        console.error(error);
        dom.scope.hidden = true;
    }
}

async function getResponse(text, allowedTools = null) {
    if (window.api.agentChat) {
        return await window.api.agentChat(text, {allowedTools});
    }
    return {
        content: (await window.api.chat(text)).choices[0].message.content,
        traces: [],
    };
}

async function showTouchResponse(text) {
    renderBubble(text, "touch");
    if (assistantState.touchTimer) {
        clearTimeout(assistantState.touchTimer);
    }
    assistantState.touchTimer = setTimeout(() => {
        if (assistantState.expanded) {
            toggleBubbleVisibility(false);
        }
    }, TIMEOUT_MS);
}

async function handleTouch(hitName) {
    const response = await window.api.touch(hitName);
    await showTouchResponse(response);
}

async function cancelActiveRequest() {
    if (!assistantState.activeRequest?.requestId) {
        return;
    }
    await window.api.cancelAgentChat(assistantState.activeRequest.requestId);
}

async function handleChat(text, allowedTools = getAllowedToolsForRequest()) {
    assistantState.lastRetryText = "";
    assistantState.lastRetryAllowedTools = null;
    syncRequestControls();
    resetRuntimeState();

    makeChatEntry(CONFIG.ASSISTANT_CONFIG.ROLE_USER, text, CONFIG.ASSISTANT_CONFIG.STATUS_SENT);
    const assistantEntry = makeChatEntry(
        CONFIG.ASSISTANT_CONFIG.ROLE_ASSISTANT,
        CONFIG.ASSISTANT_CONFIG.THINKING_TEXT,
        CONFIG.ASSISTANT_CONFIG.STATUS_PREPARING,
    );

    let responseText = "";
    let hasLiveContent = false;
    let timedOut = false;
    let canceled = false;

    const updateAssistantContent = (nextText) => {
        responseText = nextText || "";
        renderMarkdown(assistantEntry.content, responseText || CONFIG.ASSISTANT_CONFIG.THINKING_TEXT);
        const expandForResponse = shouldExpandForChat(responseText, assistantState.runtimeTraces);
        if (!assistantState.expanded && expandForResponse) {
            setLayout(true);
            assistantState.shouldStickToBottom = true;
            scrollChatToBottom(true);
        } else {
            scrollChatToBottom();
        }
        if (!assistantState.expanded && responseText) {
            renderBubble(responseText, "chat");
        }
    };

    setChatStatus(assistantEntry, CONFIG.ASSISTANT_CONFIG.STATUS_STREAMING);

    try {
        let response;
        if (window.api.agentChatStream) {
            const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const request = window.api.agentChatStream(text, {
                onStatus(status) {
                    setRuntimeStatus(status);
                    setChatStatus(assistantEntry, formatRuntimeStatus(status));
                },
                onTrace(trace, traces) {
                    setRuntimeTraces(traces);
                    if (!assistantState.expanded && shouldExpandForChat(responseText, traces)) {
                        setLayout(true);
                    }
                    scrollChatToBottom(true);
                },
                onContent(content) {
                    hasLiveContent = true;
                    updateAssistantContent(content);
                },
                onError() {
                    // Final error handling happens in the catch block below.
                },
                onCancel() {
                    canceled = true;
                },
            }, requestId, {allowedTools});
            assistantState.activeRequest = {requestId};
            syncRequestControls();
            scheduleRequestTimeout(async () => {
                timedOut = true;
                await cancelActiveRequest();
            });
            response = await request;
        } else {
            response = await getResponse(text, allowedTools);
        }

        if (!hasLiveContent) {
            updateAssistantContent(response?.content || "");
        }
        if ((!assistantState.runtimeTraces || !assistantState.runtimeTraces.length) && Array.isArray(response?.traces) && response.traces.length) {
            setRuntimeTraces(response.traces);
        }
        setRuntimeStatus({message: CONFIG.ASSISTANT_CONFIG.STATUS_DONE});
        setChatStatus(assistantEntry, CONFIG.ASSISTANT_CONFIG.STATUS_DONE);
        assistantState.lastRetryText = "";
        assistantState.lastRetryAllowedTools = null;
    } catch (error) {
        const isAbort = canceled || timedOut || error?.name === "AbortError";
        let fallbackMessage = CONFIG.ASSISTANT_CONFIG.REQUEST_FAILED_TEXT;
        let statusText = CONFIG.ASSISTANT_CONFIG.STATUS_ERROR;
        if (timedOut) {
            fallbackMessage = CONFIG.ASSISTANT_CONFIG.REQUEST_TIMEOUT_TEXT;
            statusText = CONFIG.ASSISTANT_CONFIG.STATUS_TIMEOUT;
        } else if (isAbort) {
            fallbackMessage = CONFIG.ASSISTANT_CONFIG.REQUEST_CANCELED_TEXT;
            statusText = CONFIG.ASSISTANT_CONFIG.STATUS_CANCELED;
        }
        if (!responseText) {
            updateAssistantContent(fallbackMessage);
        }
        setRuntimeStatus({message: statusText});
        setChatStatus(assistantEntry, statusText);
        assistantState.lastRetryText = text;
        assistantState.lastRetryAllowedTools = [...allowedTools];
        if (!isAbort) {
            console.error(error);
        }
    } finally {
        clearRequestTimeout();
        assistantState.activeRequest = null;
        syncRequestControls();
    }

    if (assistantState.expanded) {
        updateBubbleExpandButton("touch");
    } else {
        renderBubble(responseText || CONFIG.ASSISTANT_CONFIG.REQUEST_FAILED_TEXT, "chat");
    }
}

function enqueue(task) {
    assistantState.queue = assistantState.queue.then(task).catch((error) => {
        console.error(error);
        const message = CONFIG.ASSISTANT_CONFIG.REQUEST_FAILED_TEXT;
        renderBubble(message, "chat");
        makeChatEntry(CONFIG.ASSISTANT_CONFIG.ROLE_ASSISTANT, message, CONFIG.ASSISTANT_CONFIG.STATUS_ERROR);
        assistantState.activeRequest = null;
        clearRequestTimeout();
        syncRequestControls();
    });
    return assistantState.queue;
}

function wireHit() {
    assistantState.live2d.on("hit", async (hitArea) => {
        try {
            await handleTouch(hitArea[0]);
        } catch (error) {
            console.error(error);
        }
    });
}

function wireInput() {
    if (!dom.inputForm || !dom.input) return;
    dom.inputForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (assistantState.activeRequest) return;
        const text = dom.input.value.trim();
        if (!text) return;
        const allowedTools = getAllowedToolsForRequest();
        setScopeOpen(false);
        dom.input.value = "";
        await enqueue(() => handleChat(text, allowedTools));
    });
    if (dom.cancel) {
        dom.cancel.addEventListener("click", async () => {
            if (!assistantState.activeRequest) return;
            await cancelActiveRequest();
        });
    }
    if (dom.retry) {
        dom.retry.addEventListener("click", async () => {
            if (!assistantState.lastRetryText || assistantState.activeRequest) return;
            await enqueue(() => handleChat(
                assistantState.lastRetryText,
                assistantState.lastRetryAllowedTools ?? getAllowedToolsForRequest(),
            ));
        });
    }
    if (dom.runToggle) {
        dom.runToggle.addEventListener("click", () => {
            assistantState.runPanelExpanded = !assistantState.runPanelExpanded;
            syncRunPanel();
        });
    }
    if (dom.scopeTrigger) {
        dom.scopeTrigger.addEventListener("click", () => {
            setScopeOpen(!assistantState.scopeOpen);
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && assistantState.scopeOpen) {
            setScopeOpen(false);
        }
    });
    if (dom.scopeSelectAll) {
        dom.scopeSelectAll.addEventListener("click", () => {
            assistantState.selectedTools = assistantState.availableTools.map((item) => item.name);
            saveScopeSelection();
            renderScopeToolOptions();
            syncScopeSummary();
        });
    }
    if (dom.scopeClear) {
        dom.scopeClear.addEventListener("click", () => {
            assistantState.selectedTools = [];
            saveScopeSelection();
            renderScopeToolOptions();
            syncScopeSummary();
        });
    }
    document.addEventListener("click", (event) => {
        if (!assistantState.scopeOpen || !dom.scope) {
            return;
        }
        if (dom.scope.contains(event.target)) {
            return;
        }
        setScopeOpen(false);
    });
}

function wireNavBtn() {
    if (!dom.navPanel) return;
    dom.navPanel.addEventListener("click", (event) => {
        const button = event.target.closest(".assistant-actionBtn");
        if (!button) return;
        if (button.dataset.localView) {
            dispatchNavigate(button.dataset.localView);
            return;
        }
        if (button.dataset.action) {
            window.api.openWindow(button.dataset.action);
        }
    });
}

function wireChatLayout() {
    if (dom.bubbleExpand) {
        dom.bubbleExpand.addEventListener("click", () => {
            setLayout(true);
            assistantState.shouldStickToBottom = true;
            scrollChatToBottom(true);
        });
    }
    if (dom.collapse) {
        dom.collapse.addEventListener("click", () => {
            setLayout(false);
        });
    }
    if (dom.chatLog) {
        dom.chatLog.addEventListener("scroll", () => {
            assistantState.shouldStickToBottom = isNearBottom();
            updateScrollBottomButton();
        });
    }
    if (dom.scrollBottom) {
        dom.scrollBottom.addEventListener("click", () => {
            assistantState.shouldStickToBottom = true;
            scrollChatToBottom(true);
        });
    }
}

async function initAssistant() {
    mountAssistant();
    await loadAgentCapabilities();
    if (!dom.stage) return;
    initPixiApp();
    await initLive2d();
    initResizeObserver();
    placeLive2d();
    wireHit();
}

document.addEventListener("DOMContentLoaded", async () => {
    await initAssistant();
    wireInput();
    wireNavBtn();
    wireChatLayout();
});
