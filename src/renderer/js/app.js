const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const DEFAULT_VIEW = "assistant";

const settingsDom = {
    root: $(".settings-root"),
    clearContextBtn: $('[data-role="settings-clear-context"]'),
    contextMeta: $('[data-role="settings-context-meta"]'),
    contextCount: $('[data-role="settings-context-count"]'),
    contextList: $('[data-role="settings-context-list"]'),
    memoryCount: $('[data-role="settings-memory-count"]'),
    memoryList: $('[data-role="settings-memory-list"]'),
    agentMeta: $('[data-role="settings-agent-meta"]'),
    agentCapabilityList: $('[data-role="settings-agent-capability-list"]'),
    agentToolsList: $('[data-role="settings-agent-tools-list"]'),
    rebuildLibraryBtn: $('[data-role="settings-rebuild-library"]'),
    extractMemoryBtn: null,
    memoryStatus: null,
};

function ensureAgentSettingsCard() {
    const grid = $(".settings-grid");
    if (!grid || settingsDom.agentMeta) {
        return;
    }

    const section = document.createElement("section");
    section.className = "placeholder-card settings-card";
    section.innerHTML = `
        <h3 class="settings-card__title">Agent workspace</h3>
        <p class="settings-card__desc">Large-window mode agent tools, file index, and capability status.</p>
        <div class="settings-actions">
            <button type="button" class="settings-btn" data-role="settings-rebuild-library">Rebuild library index</button>
            <span class="settings-inlineMeta" data-role="settings-agent-meta">Agent loading...</span>
        </div>
        <div class="settings-dataPanel">
            <div class="settings-dataPanel__head">
                <h4 class="settings-dataPanel__title">Capabilities</h4>
            </div>
            <div class="settings-recordList" data-role="settings-agent-capability-list"></div>
        </div>
        <div class="settings-dataPanel">
            <div class="settings-dataPanel__head">
                <h4 class="settings-dataPanel__title">Tools</h4>
            </div>
            <div class="settings-recordList" data-role="settings-agent-tools-list"></div>
        </div>
    `;
    grid.appendChild(section);

    settingsDom.agentMeta = $('[data-role="settings-agent-meta"]');
    settingsDom.agentCapabilityList = $('[data-role="settings-agent-capability-list"]');
    settingsDom.agentToolsList = $('[data-role="settings-agent-tools-list"]');
    settingsDom.rebuildLibraryBtn = $('[data-role="settings-rebuild-library"]');
}

function ensureMemoryControls() {
    if (!settingsDom.root || settingsDom.extractMemoryBtn) {
        return;
    }

    const actions = $(".settings-actions", settingsDom.root);
    if (actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "settings-btn";
        button.dataset.role = "settings-extract-memory";
        button.textContent = "Extract long-term memory";
        actions.appendChild(button);
        settingsDom.extractMemoryBtn = button;
    }

    if (settingsDom.memoryList && !settingsDom.memoryStatus) {
        const status = document.createElement("p");
        status.className = "settings-inlineMeta";
        status.dataset.role = "settings-memory-status";
        status.textContent = "Memory extractor is idle.";
        settingsDom.memoryList.parentElement?.appendChild(status);
        settingsDom.memoryStatus = status;
    }
}

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
        hintText.textContent = `Current view: ${viewKey}`;
    }

    if (viewKey === "settings") {
        syncSettingsData().catch((error) => {
            console.error(error);
        });
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
        settingsDom.contextList.innerHTML = renderEmptyRecord("No short-term context yet.");
        return;
    }

    settingsDom.contextList.innerHTML = items.map((item, index) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${item.role === "assistant" ? "Assistant" : "User"} #${index + 1}</h5>
                <span class="settings-record__meta">${escapeHtml(item.role)}</span>
            </div>
            <p class="settings-record__body">${escapeHtml(item.message)}</p>
        </article>
    `).join("");
}

function renderMemoryList(items) {
    if (!settingsDom.memoryList) return;
    if (!items.length) {
        settingsDom.memoryList.innerHTML = renderEmptyRecord("No long-term memory yet.");
        return;
    }

    settingsDom.memoryList.innerHTML = items.map((item) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <div>
                    <h5 class="settings-record__title">${escapeHtml(item.title)}</h5>
                    <span class="settings-record__meta">${escapeHtml(item.source || "manual")}</span>
                </div>
                <button type="button" class="settings-record__action" data-action="delete-memory" data-memory-id="${escapeHtml(item.id)}">Delete</button>
            </div>
            <p class="settings-record__body">${escapeHtml(item.content)}</p>
        </article>
    `).join("");
}

function renderAgentCapabilityList(capabilities) {
    if (!settingsDom.agentCapabilityList) return;
    if (!capabilities) {
        settingsDom.agentCapabilityList.innerHTML = renderEmptyRecord("Agent capability data is unavailable.");
        return;
    }

    const items = [
        ["Vision model", capabilities.visionEnabled ? "enabled" : "disabled"],
        ["Library roots", String(capabilities.libraryRootCount ?? 0)],
        ["Indexed files", String(capabilities.libraryFileCount ?? 0)],
        ["Last index update", capabilities.libraryUpdatedAt || "not indexed"],
    ];

    settingsDom.agentCapabilityList.innerHTML = items.map(([title, value]) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${escapeHtml(title)}</h5>
            </div>
            <p class="settings-record__body">${escapeHtml(value)}</p>
        </article>
    `).join("");
}

function renderAgentToolList(tools) {
    if (!settingsDom.agentToolsList) return;
    if (!Array.isArray(tools) || !tools.length) {
        settingsDom.agentToolsList.innerHTML = renderEmptyRecord("No tools exposed.");
        return;
    }

    settingsDom.agentToolsList.innerHTML = tools.map((toolName) => `
        <article class="settings-record">
            <div class="settings-record__head">
                <h5 class="settings-record__title">${escapeHtml(toolName)}</h5>
            </div>
        </article>
    `).join("");
}

function setMemoryStatus(text) {
    if (settingsDom.memoryStatus) {
        settingsDom.memoryStatus.textContent = text;
    }
}

async function syncSettingsData() {
    if (!window.api.getAiContextData || !window.api.getLongTermMemoryData) return;

    const jobs = [
        window.api.getAiContextData(),
        window.api.getLongTermMemoryData(),
    ];

    if (window.api.getAgentCapabilities) {
        jobs.push(window.api.getAgentCapabilities());
    }

    const [contextData, memoryData, agentCapabilities] = await Promise.all(jobs);

    if (settingsDom.contextMeta) {
        settingsDom.contextMeta.textContent = `Saved context: ${contextData.messageCount}`;
    }
    if (settingsDom.contextCount) {
        settingsDom.contextCount.textContent = `${contextData.messageCount} messages`;
    }
    if (settingsDom.memoryCount) {
        settingsDom.memoryCount.textContent = `${memoryData.memoryCount} memories`;
    }
    if (settingsDom.agentMeta) {
        settingsDom.agentMeta.textContent = agentCapabilities
            ? `Indexed ${agentCapabilities.libraryFileCount} files`
            : "Agent unavailable";
    }

    renderContextList(contextData.items || []);
    renderMemoryList(memoryData.items || []);
    renderAgentCapabilityList(agentCapabilities);
    renderAgentToolList(agentCapabilities?.tools || []);
}

async function handleExtractMemory() {
    if (!window.api.extractLongTermMemories || !settingsDom.extractMemoryBtn) {
        return;
    }
    settingsDom.extractMemoryBtn.disabled = true;
    setMemoryStatus("Extracting memories from recent context...");
    try {
        const result = await window.api.extractLongTermMemories();
        const addedCount = Array.isArray(result?.added) ? result.added.length : 0;
        const skippedCount = Array.isArray(result?.skipped) ? result.skipped.length : 0;
        setMemoryStatus(`Extraction finished. Added ${addedCount}, skipped ${skippedCount}.`);
        await syncSettingsData();
    } catch (error) {
        console.error(error);
        setMemoryStatus(`Extraction failed: ${error.message || error}`);
    } finally {
        settingsDom.extractMemoryBtn.disabled = false;
    }
}

async function handleDeleteMemory(memoryId) {
    if (!window.api.deleteLongTermMemory) {
        return;
    }
    setMemoryStatus("Deleting memory...");
    try {
        await window.api.deleteLongTermMemory(memoryId);
        setMemoryStatus("Memory deleted.");
        await syncSettingsData();
    } catch (error) {
        console.error(error);
        setMemoryStatus(`Delete failed: ${error.message || error}`);
    }
}

function wireSettingsActions() {
    if (settingsDom.clearContextBtn && window.api.clearAiContext) {
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

    if (settingsDom.extractMemoryBtn) {
        settingsDom.extractMemoryBtn.addEventListener("click", async () => {
            await handleExtractMemory();
        });
    }

    if (settingsDom.rebuildLibraryBtn && window.api.rebuildAgentLibraryIndex) {
        settingsDom.rebuildLibraryBtn.addEventListener("click", async () => {
            settingsDom.rebuildLibraryBtn.disabled = true;
            try {
                await window.api.rebuildAgentLibraryIndex();
                await syncSettingsData();
                window.dispatchEvent(new CustomEvent("organizer:refresh"));
            } finally {
                settingsDom.rebuildLibraryBtn.disabled = false;
            }
        });
    }

    if (settingsDom.memoryList) {
        settingsDom.memoryList.addEventListener("click", async (event) => {
            const button = event.target.closest('[data-action="delete-memory"]');
            if (!button) return;
            await handleDeleteMemory(button.dataset.memoryId);
        });
    }
}

function boot() {
    ensureAgentSettingsCard();
    ensureMemoryControls();
    wireNav();
    wireIpc();
    wireCustomNavigation();
    wireSettingsActions();
    showView(DEFAULT_VIEW);
}

document.addEventListener("DOMContentLoaded", boot);
