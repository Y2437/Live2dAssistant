const dom = {
    language: document.querySelector('[data-role="quick-float-language"]'),
    translate: document.querySelector('[data-role="quick-float-translate"]'),
    explain: document.querySelector('[data-role="quick-float-explain"]'),
    close: document.querySelector('[data-role="quick-float-close"]'),
    result: document.querySelector('[data-role="quick-float-result"]'),
    output: document.querySelector('[data-role="quick-float-output"]'),
    copy: document.querySelector('[data-role="quick-float-copy"]'),
    collapse: document.querySelector('[data-role="quick-float-collapse"]'),
};

const LOG_PREFIX = "[quick-float]";
const WINDOW_SIZE = {
    width: 360,
    compactHeight: 48,
    expandedHeight: 332,
    expandedMaxHeight: 560,
};

const state = {
    selectedText: "",
    featureEnabled: true,
    expanded: false,
    busy: false,
};

function syncInteractionState(interacting) {
    if (window.api?.quickFloatSetInteractionState) {
        window.api.quickFloatSetInteractionState({interacting: interacting === true}).catch(() => {});
    }
}

function resizeWindow(expanded) {
    let compactHeight = WINDOW_SIZE.compactHeight;
    let expandedHeight = WINDOW_SIZE.expandedHeight;
    const root = document.querySelector(".quick-float-root");
    const card = document.querySelector(".quick-float-card");
    if (expanded && root && card) {
        const rootStyle = window.getComputedStyle(root);
        const rootPaddingY = (parseFloat(rootStyle.paddingTop) || 0) + (parseFloat(rootStyle.paddingBottom) || 0);
        const natural = Math.ceil(card.getBoundingClientRect().height + rootPaddingY + 2);
        expandedHeight = Math.min(WINDOW_SIZE.expandedMaxHeight, Math.max(WINDOW_SIZE.compactHeight + 120, natural));
    }
    if (!expanded) {
        const miniActions = document.querySelector(".quick-float-miniActions");
        if (root && card && miniActions) {
            const rootStyle = window.getComputedStyle(root);
            const cardStyle = window.getComputedStyle(card);
            const rootPaddingY = (parseFloat(rootStyle.paddingTop) || 0) + (parseFloat(rootStyle.paddingBottom) || 0);
            const cardPaddingY = (parseFloat(cardStyle.paddingTop) || 0) + (parseFloat(cardStyle.paddingBottom) || 0);
            const cardBorderY = (parseFloat(cardStyle.borderTopWidth) || 0) + (parseFloat(cardStyle.borderBottomWidth) || 0);
            const actionsHeight = miniActions.getBoundingClientRect().height || 0;
            compactHeight = Math.max(28, Math.ceil(rootPaddingY + cardPaddingY + cardBorderY + actionsHeight + 2));
        }
    }
    const height = expanded ? expandedHeight : compactHeight;
    const fallbackResize = () => {
        try {
            window.resizeTo(WINDOW_SIZE.width, height);
        } catch (error) {
            // ignore
        }
    };
    try {
        if (window.api?.quickFloatSetWindowMode) {
            window.api.quickFloatSetWindowMode({expanded, width: WINDOW_SIZE.width, height})
                .then((result) => {
                    if (!result?.ok) {
                        fallbackResize();
                    }
                })
                .catch(() => {
                    fallbackResize();
                });
        } else {
            fallbackResize();
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} resize-failed`, error?.message || error);
    }
}

function syncActionEnabled() {
    const hasSelection = Boolean(state.selectedText);
    const disabledByFeature = !state.featureEnabled || state.busy || !hasSelection;
    [dom.translate, dom.explain, dom.language].filter(Boolean).forEach((element) => {
        element.disabled = disabledByFeature;
    });
    [dom.copy, dom.collapse].filter(Boolean).forEach((element) => {
        element.disabled = state.busy || !state.featureEnabled || !state.expanded;
    });
}

function setBusy(busy) {
    state.busy = Boolean(busy);
    syncActionEnabled();
}

function setExpanded(expanded) {
    state.expanded = Boolean(expanded);
    if (dom.result) {
        dom.result.hidden = !state.expanded;
    }
    resizeWindow(state.expanded);
    syncActionEnabled();
}

function updateSelectedText(text, source = "selection-shortcut") {
    state.selectedText = String(text || "").trim();
    console.log(`${LOG_PREFIX} selection-updated`, {
        source,
        textLength: state.selectedText.length,
    });
    if (dom.output) {
        dom.output.value = "";
    }
    setExpanded(false);
    syncActionEnabled();
}

async function runTask(mode) {
    if (!state.selectedText || !state.featureEnabled) {
        return;
    }
    const targetLanguage = String(dom.language?.value || "中文").trim() || "中文";

    setBusy(true);
    try {
        const payload = {text: state.selectedText, targetLanguage};
        const result = mode === "translate"
            ? await window.api.quickTranslateText(payload)
            : await window.api.quickExplainText(payload);
        const output = String(result?.text || "").trim();
        if (!output) {
            throw new Error("模型未返回内容。");
        }
        if (dom.output) {
            dom.output.value = output;
        }
        setExpanded(true);
    } catch (error) {
        console.error(`${LOG_PREFIX} request-failed`, error);
        if (dom.output) {
            dom.output.value = `请求失败：${error?.message || "未知错误"}`;
        }
        setExpanded(true);
    } finally {
        setBusy(false);
    }
}

function wireSelectionEvents() {
    if (window.api?.onQuickFloatFeatureToggle) {
        window.api.onQuickFloatFeatureToggle((payload = {}) => {
            state.featureEnabled = payload?.enabled !== false;
            if (!state.featureEnabled) {
                window.close();
                return;
            }
            syncActionEnabled();
        });
    }
    if (window.api?.onQuickFloatSelectionReady) {
        window.api.onQuickFloatSelectionReady((payload = {}) => {
            if (state.busy || state.expanded) {
                return;
            }
            updateSelectedText(payload?.text || "", payload?.source || "selection-shortcut");
        });
    }
    if (window.api?.onQuickFloatSelectionError) {
        window.api.onQuickFloatSelectionError(() => {
            updateSelectedText("", "selection-error");
        });
    }
}

function wireEvents() {
    wireSelectionEvents();

    window.addEventListener("focus", () => syncInteractionState(true));
    window.addEventListener("blur", () => syncInteractionState(false));
    document.addEventListener("pointerdown", () => syncInteractionState(true), true);
    document.addEventListener("pointerup", () => syncInteractionState(true), true);
    document.addEventListener("mouseenter", () => syncInteractionState(true), true);
    document.addEventListener("mouseleave", () => syncInteractionState(false), true);

    dom.translate?.addEventListener("click", async () => {
        syncInteractionState(true);
        await runTask("translate");
    });

    dom.explain?.addEventListener("click", async () => {
        syncInteractionState(true);
        await runTask("explain");
    });

    dom.copy?.addEventListener("click", async () => {
        const output = String(dom.output?.value || "").trim();
        if (!output) {
            return;
        }
        try {
            await navigator.clipboard.writeText(output);
        } catch (error) {
            console.error(`${LOG_PREFIX} copy-failed`, error);
        }
    });

    dom.collapse?.addEventListener("click", () => {
        setExpanded(false);
    });

    dom.close?.addEventListener("click", () => {
        syncInteractionState(false);
        window.close();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    wireEvents();
    syncInteractionState(false);
    setExpanded(false);
    if (window.api?.getQuickFloatFeatureState) {
        window.api.getQuickFloatFeatureState()
            .then((payload = {}) => {
                state.featureEnabled = payload?.enabled !== false;
                if (!state.featureEnabled) {
                    window.close();
                    return;
                }
                syncActionEnabled();
            })
            .catch(() => {});
    }
    console.log(`${LOG_PREFIX} boot-ready`);
});

window.addEventListener("beforeunload", () => {
    syncInteractionState(false);
});
