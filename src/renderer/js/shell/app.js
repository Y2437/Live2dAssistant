import { $, $$ } from "../shared/dom.js";
import { CONFIG } from "../core/config.js";
import {
    renderAgentCapabilityList,
    renderAgentToolList,
    renderContextList,
    renderMemoryList,
} from "../settings/view.js";

const DEFAULT_VIEW = CONFIG.DEFAULT_VIEW;

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
    memoryRoutineMeta: null,
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

    if (settingsDom.memoryList && !settingsDom.memoryRoutineMeta) {
        const meta = document.createElement("p");
        meta.className = "settings-inlineMeta";
        meta.dataset.role = "settings-memory-routine-meta";
        meta.textContent = "Daily memory routine status unavailable.";
        settingsDom.memoryList.parentElement?.appendChild(meta);
        settingsDom.memoryRoutineMeta = meta;
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

function setMemoryStatus(text) {
    if (settingsDom.memoryStatus) {
        settingsDom.memoryStatus.textContent = text;
    }
}

function setMemoryRoutineMeta(meta) {
    if (!settingsDom.memoryRoutineMeta) return;
    if (!meta) {
        settingsDom.memoryRoutineMeta.textContent = "Daily memory routine status unavailable.";
        return;
    }
    const parts = [
        `Daily routine: ${meta.lastStatus || "idle"}`,
        meta.lastRunAt ? `last run ${meta.lastRunAt}` : "",
        Number.isFinite(meta.lastAddedCount) ? `added ${meta.lastAddedCount}` : "",
        Number.isFinite(meta.lastSkippedCount) ? `skipped ${meta.lastSkippedCount}` : "",
        meta.lastError ? `error ${meta.lastError}` : "",
    ].filter(Boolean);
    settingsDom.memoryRoutineMeta.textContent = parts.join(" · ");
}

async function syncSettingsData() {
    if (!window.api.getAiContextData || !window.api.getLongTermMemoryData) return;

    const jobs = [
        window.api.getAiContextData(),
        window.api.getLongTermMemoryData(),
    ];
    if (window.api.getMemoryRoutineMeta) {
        jobs.push(window.api.getMemoryRoutineMeta());
    }

    if (window.api.getAgentCapabilities) {
        jobs.push(window.api.getAgentCapabilities());
    }

    const [contextData, memoryData, memoryRoutineMeta, agentCapabilities] = await Promise.all(jobs);

    if (settingsDom.contextMeta) {
        settingsDom.contextMeta.textContent = `Saved context: ${contextData.messageCount}`;
    }
    if (settingsDom.contextCount) {
        settingsDom.contextCount.textContent = `${contextData.messageCount} messages`;
    }
    if (settingsDom.memoryCount) {
        const activeCount = memoryData?.stats?.activeCount ?? memoryData.memoryCount;
        const categorySummary = Object.entries(memoryData?.stats?.categoryCounts || {})
            .slice(0, 4)
            .map(([name, count]) => `${name}:${count}`)
            .join(" · ");
        settingsDom.memoryCount.textContent = `${activeCount}/${memoryData.memoryCount} active${categorySummary ? ` · ${categorySummary}` : ""}`;
    }
    if (settingsDom.agentMeta) {
        settingsDom.agentMeta.textContent = agentCapabilities
            ? `Indexed ${agentCapabilities.libraryFileCount} files`
            : "Agent unavailable";
    }
    if (settingsDom.contextList) {
        settingsDom.contextList.innerHTML = renderContextList(contextData.items || []);
    }
    if (settingsDom.memoryList) {
        settingsDom.memoryList.innerHTML = renderMemoryList(memoryData.items || []);
    }
    setMemoryRoutineMeta(memoryRoutineMeta);
    if (settingsDom.agentCapabilityList) {
        settingsDom.agentCapabilityList.innerHTML = renderAgentCapabilityList(agentCapabilities);
    }
    if (settingsDom.agentToolsList) {
        settingsDom.agentToolsList.innerHTML = renderAgentToolList(agentCapabilities?.tools || []);
    }
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
