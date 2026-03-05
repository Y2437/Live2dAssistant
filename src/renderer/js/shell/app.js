import { $, $$ } from "../shared/dom.js";
import { CONFIG } from "../core/config.js";
import { measureAsync, measureSync } from "../shared/perf.js";
import {
    renderAgentCapabilityList,
    renderAgentSelfTestList,
    renderAgentToolList,
    renderContextList,
    renderMemoryList,
} from "../settings/view.js";

const DEFAULT_VIEW = CONFIG.DEFAULT_VIEW;
const ASSISTANT_DIRECT_MODE_STORAGE_KEY = "assistant.directMode.v1";
const CLIPBOARD_AUTO_CAPTURE_STORAGE_KEY = "clipboard.autoCapture.v1";
const SETTINGS_THEME_STORAGE_KEY = "settings.theme.v1";
const SETTINGS_START_VIEW_STORAGE_KEY = "settings.startView.v1";

const settingsDom = {
    root: $(".settings-root"),
    clearContextBtn: $('[data-role="settings-clear-context"]'),
    extractMemoryBtn: $('[data-role="settings-extract-memory"]'),
    contextMeta: $('[data-role="settings-context-meta"]'),
    contextCount: $('[data-role="settings-context-count"]'),
    contextList: $('[data-role="settings-context-list"]'),
    memoryCount: $('[data-role="settings-memory-count"]'),
    memoryList: $('[data-role="settings-memory-list"]'),
    memoryStatus: $('[data-role="settings-memory-status"]'),
    memoryRoutineMeta: $('[data-role="settings-memory-routine-meta"]'),
    agentMeta: $('[data-role="settings-agent-meta"]'),
    agentCapabilityList: $('[data-role="settings-agent-capability-list"]'),
    agentToolsList: $('[data-role="settings-agent-tools-list"]'),
    runSelfTestBtn: $('[data-role="settings-run-self-test"]'),
    selfTestMeta: $('[data-role="settings-self-test-meta"]'),
    selfTestList: $('[data-role="settings-self-test-list"]'),
    themeSelect: $('[data-role="settings-theme"]'),
    startViewSelect: $('[data-role="settings-start-view"]'),
    directModeDefaultToggle: $('[data-role="settings-direct-mode-default"]'),
    clipboardAutoDefaultToggle: $('[data-role="settings-clipboard-auto-default"]'),
    prefStatus: $('[data-role="settings-pref-status"]'),
    selfTestResult: null,
};
const VIEW_TRANSITION_MS = 180;
let settingsSyncTimer = null;

function readStorage(key, fallback = "") {
    try {
        const value = window.localStorage.getItem(key);
        return value == null ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (error) {
        console.error(error);
    }
}

function readBooleanStorage(key, fallback = false) {
    const raw = readStorage(key, fallback ? "true" : "false");
    return raw === "true";
}

function setPreferenceStatus(text) {
    if (settingsDom.prefStatus) {
        settingsDom.prefStatus.textContent = text;
    }
}

function resolveTheme(value) {
    return value === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
    const resolved = resolveTheme(theme);
    document.documentElement.setAttribute("data-theme", resolved);
    if (settingsDom.themeSelect) {
        settingsDom.themeSelect.value = resolved;
    }
}

function loadThemePreference() {
    const fromStorage = readStorage(SETTINGS_THEME_STORAGE_KEY, "");
    if (fromStorage === "light" || fromStorage === "dark") {
        return fromStorage;
    }
    const fromDocument = document.documentElement.getAttribute("data-theme");
    return resolveTheme(fromDocument || "light");
}

function saveThemePreference(theme) {
    const resolved = resolveTheme(theme);
    writeStorage(SETTINGS_THEME_STORAGE_KEY, resolved);
    applyTheme(resolved);
    setPreferenceStatus(`主题已切换到：${resolved === "dark" ? "深色" : "浅色"}`);
}

function availableInShellView(viewKey) {
    return Boolean(document.querySelector(`.view[data-view="${viewKey}"]`));
}

function resolveStartView(viewKey) {
    const normalized = String(viewKey || "").trim();
    return availableInShellView(normalized) ? normalized : DEFAULT_VIEW;
}

function loadStartViewPreference() {
    return resolveStartView(readStorage(SETTINGS_START_VIEW_STORAGE_KEY, DEFAULT_VIEW));
}

function saveStartViewPreference(viewKey) {
    const resolved = resolveStartView(viewKey);
    writeStorage(SETTINGS_START_VIEW_STORAGE_KEY, resolved);
    if (settingsDom.startViewSelect) {
        settingsDom.startViewSelect.value = resolved;
    }
    setPreferenceStatus(`启动默认视图已更新为：${resolved}`);
}

function loadBehaviorPreferencesIntoControls() {
    if (settingsDom.directModeDefaultToggle) {
        settingsDom.directModeDefaultToggle.checked = readBooleanStorage(ASSISTANT_DIRECT_MODE_STORAGE_KEY, false);
    }
    if (settingsDom.clipboardAutoDefaultToggle) {
        settingsDom.clipboardAutoDefaultToggle.checked = readBooleanStorage(CLIPBOARD_AUTO_CAPTURE_STORAGE_KEY, false);
    }
}

function saveBehaviorPreferencesFromControls() {
    if (settingsDom.directModeDefaultToggle) {
        writeStorage(ASSISTANT_DIRECT_MODE_STORAGE_KEY, String(settingsDom.directModeDefaultToggle.checked));
    }
    if (settingsDom.clipboardAutoDefaultToggle) {
        writeStorage(CLIPBOARD_AUTO_CAPTURE_STORAGE_KEY, String(settingsDom.clipboardAutoDefaultToggle.checked));
    }
    setPreferenceStatus("行为偏好已保存。");
}

function syncPreferencesUI() {
    applyTheme(loadThemePreference());
    if (settingsDom.startViewSelect) {
        settingsDom.startViewSelect.value = loadStartViewPreference();
    }
    loadBehaviorPreferencesIntoControls();
}

function setNavBtnActive(viewKey) {
    $$(".nav__btn").forEach((navBtn) => {
        navBtn.classList.toggle("is-active", navBtn.dataset.view === viewKey);
    });
}

function showView(viewKey) {
    measureSync("shell.showView", () => {
        const views = $$(".view");
        setNavBtnActive(viewKey);
        views.forEach((view) => {
            view.classList.toggle("is-active", view.dataset.view === viewKey);
        });
    }, {viewKey});

    const hintText = $('p.nav__hint[data-role="ActiveText"]');
    if (hintText) {
        hintText.textContent = `Current view: ${viewKey}`;
    }

    if (viewKey === "settings") {
        syncPreferencesUI();
        if (settingsSyncTimer) {
            clearTimeout(settingsSyncTimer);
            settingsSyncTimer = null;
        }
        settingsSyncTimer = window.setTimeout(() => {
            settingsSyncTimer = null;
            measureAsync("settings.syncSettingsData", async () => await syncSettingsData(), {viewKey: "settings"}).catch((error) => {
                console.error(error);
            });
        }, VIEW_TRANSITION_MS);
    }

    window.dispatchEvent(new CustomEvent("shell:viewchange", {
        detail: {viewKey},
    }));
}

async function navigate(viewKey) {
    const startMeta = {viewKey};
    if (!viewKey) return;
    if (document.querySelector(`.view[data-view="${viewKey}"]`)) {
        measureSync("shell.navigate.local", () => {
            showView(viewKey);
        }, startMeta);
        return;
    }
    await measureAsync("shell.navigate.remote", async () => await window.api.openWindow(viewKey), startMeta);
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
    settingsDom.memoryRoutineMeta.textContent = parts.join(" | ");
}

function setSelfTestMeta(text) {
    if (settingsDom.selfTestMeta) {
        settingsDom.selfTestMeta.textContent = text;
    }
}

function syncSelfTestView() {
    if (settingsDom.selfTestList) {
        settingsDom.selfTestList.innerHTML = renderAgentSelfTestList(settingsDom.selfTestResult);
    }
    const summary = settingsDom.selfTestResult?.summary;
    if (!summary) {
        setSelfTestMeta("No self-test result yet.");
        return;
    }
    setSelfTestMeta(`Checked ${summary.total} tools | ${summary.successCount} success | ${summary.errorCount} error`);
}

async function syncSettingsData() {
    return await measureAsync("settings.syncSettingsData.body", async () => {
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
                .join(" | ");
            settingsDom.memoryCount.textContent = `${activeCount}/${memoryData.memoryCount} active${categorySummary ? ` | ${categorySummary}` : ""}`;
        }
        if (settingsDom.agentMeta) {
            settingsDom.agentMeta.textContent = agentCapabilities ? "Agent available" : "Agent unavailable";
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
        syncSelfTestView();
    });
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

async function handleRunAgentSelfTest() {
    if (!window.api.runAgentSelfTest || !settingsDom.runSelfTestBtn) {
        return;
    }
    settingsDom.runSelfTestBtn.disabled = true;
    setSelfTestMeta("Running self-test...");
    try {
        const result = await window.api.runAgentSelfTest("settings self-test");
        settingsDom.selfTestResult = result || null;
        syncSelfTestView();
    } catch (error) {
        console.error(error);
        settingsDom.selfTestResult = {
            summary: {total: 1, successCount: 0, errorCount: 1},
            traces: [{
                tool: "runAgentSelfTest",
                status: "error",
                phase: "self-test",
                input: {},
                outputPreview: {error: error.message || String(error)},
            }],
        };
        syncSelfTestView();
    } finally {
        settingsDom.runSelfTestBtn.disabled = false;
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

    if (settingsDom.runSelfTestBtn) {
        settingsDom.runSelfTestBtn.addEventListener("click", async () => {
            await handleRunAgentSelfTest();
        });
    }

    if (settingsDom.memoryList) {
        settingsDom.memoryList.addEventListener("click", async (event) => {
            const button = event.target.closest('[data-action="delete-memory"]');
            if (!button) return;
            await handleDeleteMemory(button.dataset.memoryId);
        });
    }

    if (settingsDom.themeSelect) {
        settingsDom.themeSelect.addEventListener("change", () => {
            saveThemePreference(settingsDom.themeSelect.value);
        });
    }

    if (settingsDom.startViewSelect) {
        settingsDom.startViewSelect.addEventListener("change", () => {
            saveStartViewPreference(settingsDom.startViewSelect.value);
        });
    }

    if (settingsDom.directModeDefaultToggle) {
        settingsDom.directModeDefaultToggle.addEventListener("change", saveBehaviorPreferencesFromControls);
    }

    if (settingsDom.clipboardAutoDefaultToggle) {
        settingsDom.clipboardAutoDefaultToggle.addEventListener("change", saveBehaviorPreferencesFromControls);
    }
}

function boot() {
    applyTheme(loadThemePreference());
    wireNav();
    wireIpc();
    wireCustomNavigation();
    wireSettingsActions();
    showView(loadStartViewPreference());
}

document.addEventListener("DOMContentLoaded", boot);
