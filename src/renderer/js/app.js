const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const DEFAULT_VIEW = "assistant";
const settingsDom = {
    clearContextBtn: $('[data-role="settings-clear-context"]'),
    contextMeta: $('[data-role="settings-context-meta"]'),
    contextCount: $('[data-role="settings-context-count"]'),
    contextList: $('[data-role="settings-context-list"]'),
    memoryCount: $('[data-role="settings-memory-count"]'),
    memoryList: $('[data-role="settings-memory-list"]'),
};

function setNavBtnActive(viewKey) {
    $$(".nav__btn").forEach((navBtn) => {
        navBtn.classList.toggle("is-active", navBtn.dataset.view === viewKey);
    });
}

function showView(viewKey) {
    const views = $$(".view");
    setNavBtnActive(viewKey);
    views.forEach((view) => {
        view.classList.toggle("is-active", view.dataset.view === viewKey);
    });

    const hintText = $('p.nav__hint[data-role="ActiveText"]');
    if (hintText) {
        hintText.textContent = `当前激活视图：${viewKey}`;
    }

    if (viewKey === "settings") {
        syncSettingsData();
    }

    window.dispatchEvent(new CustomEvent("shell:viewchange", {
        detail: {viewKey},
    }));
}

async function navigate(viewKey) {
    if (!viewKey) return;
    if (document.querySelector(`.view[data-view="${viewKey}"]`)) {
        showView(viewKey);
        return;
    }
    await window.api.openWindow(viewKey);
}

function wireNav() {
    const nav = $("nav.shell__nav");
    nav.addEventListener("click", async (event) => {
        const button = event.target.closest(".nav__btn");
        if (!button) return;
        await navigate(button.dataset.view);
    });
}

function wireIpc() {
    window.api.onShowView((payload) => {
        showView(payload.viewKey);
    });
}

function wireCustomNavigation() {
    window.addEventListener("shell:navigate", async (event) => {
        await navigate(event.detail?.viewKey);
    });
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function renderEmptyRecord(text) {
    return `
        <article class="settings-record settings-record--empty">
            <p class="settings-record__body">${escapeHtml(text)}</p>
        </article>
    `;
}

function renderContextList(items) {
    if (!settingsDom.contextList) return;
    if (!items.length) {
        settingsDom.contextList.innerHTML = renderEmptyRecord("当前没有短期上下文。");
        return;
    }

    settingsDom.contextList.innerHTML = items.map((item, index) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${item.role === "assistant" ? "Assistant" : "User"} #${index + 1}</h5>
                <span class="settings-record__meta">${item.role}</span>
            </div>
            <p class="settings-record__body">${escapeHtml(item.message)}</p>
        </article>
    `).join("");
}

function renderMemoryList(items) {
    if (!settingsDom.memoryList) return;
    if (!items.length) {
        settingsDom.memoryList.innerHTML = renderEmptyRecord("当前没有长期记忆。");
        return;
    }

    settingsDom.memoryList.innerHTML = items.map((item) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${escapeHtml(item.title)}</h5>
                <span class="settings-record__meta">${escapeHtml(item.source || "manual")}</span>
            </div>
            <p class="settings-record__body">${escapeHtml(item.content)}</p>
        </article>
    `).join("");
}

async function syncSettingsData() {
    if (!window.api.getAiContextData || !window.api.getLongTermMemoryData) return;

    const [contextData, memoryData] = await Promise.all([
        window.api.getAiContextData(),
        window.api.getLongTermMemoryData(),
    ]);

    if (settingsDom.contextMeta) {
        settingsDom.contextMeta.textContent = `已保存上下文：${contextData.messageCount} 条`;
    }
    if (settingsDom.contextCount) {
        settingsDom.contextCount.textContent = `${contextData.messageCount} 条消息`;
    }
    if (settingsDom.memoryCount) {
        settingsDom.memoryCount.textContent = `${memoryData.memoryCount} 条记忆`;
    }

    renderContextList(contextData.items || []);
    renderMemoryList(memoryData.items || []);
}

function wireSettingsActions() {
    if (!settingsDom.clearContextBtn || !window.api.clearAiContext) return;
    settingsDom.clearContextBtn.addEventListener("click", async () => {
        settingsDom.clearContextBtn.disabled = true;
        try {
            await window.api.clearAiContext();
            await syncSettingsData();
        } finally {
            settingsDom.clearContextBtn.disabled = false;
        }
    });
}

function boot() {
    wireNav();
    wireIpc();
    wireCustomNavigation();
    wireSettingsActions();
    showView(DEFAULT_VIEW);
}

document.addEventListener("DOMContentLoaded", boot);
