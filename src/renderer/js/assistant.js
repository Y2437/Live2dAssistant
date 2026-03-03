import { CONFIG } from "./config.js";
import { marked } from "../vendor/marked/lib/marked.esm.js";

const $ = (selector, root = document) => root.querySelector(selector);

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
    input: $('[data-role="assistant-input"]'),
    navPanel: $('[data-role="assistant-actions"]'),
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
};

const TIMEOUT_MS = CONFIG.LIVE2D_CONFIG.TIMEOUT_MS;
const WIDTH_FALLBACK = CONFIG.LIVE2D_CONFIG.WIDTH;
const HEIGHT_FALLBACK = CONFIG.LIVE2D_CONFIG.HEIGHT;

function dispatchNavigate(viewKey) {
    window.dispatchEvent(new CustomEvent("shell:navigate", { detail: { viewKey } }));
}

function ensureBubbleMarkup() {
    if (!dom.bubble || dom.bubbleBody) return;
    dom.bubble.innerHTML = `
        <div class="assistant-bubble__head">
            <span class="assistant-bubble__label" data-role="assistant-bubble-label">Response</span>
            <button type="button" class="assistant-bubble__expand" data-role="assistant-expand" aria-label="Expand chat panel" hidden>
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
        dom.chatMode.textContent = expanded ? "Right Panel" : "Bubble";
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
    return distance < 48;
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
    const shouldShow = !assistantState.expanded && type === "chat" && text.trim().length > 120;
    dom.bubbleExpand.hidden = !shouldShow;
}

function renderBubble(text, type = "chat") {
    if (!dom.bubble) return;
    assistantState.lastBubbleType = type;
    if (dom.bubbleLabel) {
        dom.bubbleLabel.textContent = type === "touch" ? "Touch" : "Response";
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

function formatTrace(trace, index) {
    const output = trace?.outputPreview ? `\n\n\`\`\`text\n${trace.outputPreview}\n\`\`\`` : "";
    return `### Step ${index + 1}: ${trace?.tool || "tool"}\nStatus: ${trace?.status || "unknown"}${output}`;
}

function setChatStatus(entryHandle, statusText) {
    if (entryHandle?.status) {
        entryHandle.status.textContent = statusText;
    }
}

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function streamMarkdown(text, onUpdate) {
    const source = String(text || "");
    if (!source) {
        onUpdate("");
        return;
    }
    let current = "";
    for (const char of source) {
        current += char;
        onUpdate(current);
        await wait(14);
    }
}

async function getResponse(text) {
    if (window.api.agentChat) {
        return await window.api.agentChat(text);
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

async function handleChat(text) {
    makeChatEntry("user", text, "sent");
    const assistantEntry = makeChatEntry("assistant", "Thinking...", "preparing");
    const response = await getResponse(text);
    const responseText = response?.content || "";

    setChatStatus(assistantEntry, "streaming");
    await streamMarkdown(responseText, (partialText) => {
        renderMarkdown(assistantEntry.content, partialText);
        scrollChatToBottom();
        if (!assistantState.expanded) {
            renderBubble(partialText, "chat");
        }
    });

    if (Array.isArray(response?.traces) && response.traces.length) {
        const traceEntry = makeChatEntry("agent", "", `${response.traces.length} steps`);
        renderMarkdown(
            traceEntry.content,
            response.traces.map((trace, index) => formatTrace(trace, index)).join("\n\n"),
        );
        scrollChatToBottom(true);
    }

    setChatStatus(assistantEntry, "done");

    if (assistantState.expanded) {
        updateBubbleExpandButton("touch");
    } else {
        renderBubble(responseText, "chat");
    }
}

function enqueue(task) {
    assistantState.queue = assistantState.queue.then(task).catch((error) => {
        console.error(error);
        const message = "Request failed. Please retry.";
        renderBubble(message, "chat");
        makeChatEntry("assistant", message, "error");
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
        const text = dom.input.value.trim();
        if (!text) return;
        dom.input.value = "";
        await enqueue(() => handleChat(text));
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
