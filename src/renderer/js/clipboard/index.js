import { $, $$, escapeHtml } from "../shared/dom.js";
import { measureAsync, measureSync } from "../shared/perf.js";

const AUTO_CAPTURE_STORAGE_KEY = "clipboard.autoCapture.v1";
const AUTO_CAPTURE_INTERVAL_MS = 1400;
const VIEW_TRANSITION_MS = 180;
const CLIPBOARD_SYNC_THROTTLE_MS = 2500;
const SEARCH_DEBOUNCE_MS = 120;
const CLIPBOARD_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

const clipboardState = {
    mounted: false,
    items: [],
    count: 0,
    pinnedCount: 0,
    query: "",
    filter: "all",
    autoCapture: false,
    timer: null,
    active: true,
    standalone: false,
    syncTimer: null,
    lastSyncedAt: 0,
    searchDebounceTimer: null,
    captureInFlight: false,
};

const clipboardDom = {
    root: null,
    list: null,
    empty: null,
    status: null,
    total: null,
    pinned: null,
    live: null,
    search: null,
    capture: null,
    clear: null,
    auto: null,
    filters: null,
};

function formatDate(value = "") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "未知时间";
    }
    return CLIPBOARD_DATE_FORMATTER.format(date);
}

function setStatus(text) {
    if (clipboardDom.status) {
        clipboardDom.status.textContent = text;
    }
}

function loadAutoCapturePreference() {
    try {
        return window.localStorage.getItem(AUTO_CAPTURE_STORAGE_KEY) === "true";
    } catch (error) {
        return false;
    }
}

function saveAutoCapturePreference() {
    try {
        window.localStorage.setItem(AUTO_CAPTURE_STORAGE_KEY, String(clipboardState.autoCapture));
    } catch (error) {
        console.error(error);
    }
}

function getVisibleItems() {
    const query = clipboardState.query.trim().toLowerCase();
    return clipboardState.items.filter((item) => {
        if (clipboardState.filter === "text" && item.type === "image") return false;
        if (clipboardState.filter === "image" && item.type === "text") return false;
        if (clipboardState.filter === "pinned" && item.pinned !== true) return false;
        if (!query) return true;
        const haystack = `${item.text || ""}\n${item.textPreview || ""}\n${item.type || ""}`.toLowerCase();
        return haystack.includes(query);
    });
}

function renderSummary() {
    if (clipboardDom.total) {
        clipboardDom.total.textContent = String(clipboardState.count);
    }
    if (clipboardDom.pinned) {
        clipboardDom.pinned.textContent = String(clipboardState.pinnedCount);
    }
    if (clipboardDom.auto) {
        clipboardDom.auto.dataset.enabled = clipboardState.autoCapture ? "true" : "false";
        clipboardDom.auto.textContent = clipboardState.autoCapture ? "自动记录：开" : "自动记录：关";
    }
}

function renderList() {
    measureSync("clipboard.renderList", () => {
        if (!clipboardDom.list || !clipboardDom.empty) {
            return;
        }
        const items = getVisibleItems();
        clipboardDom.list.innerHTML = items.map((item) => {
            const typeLabel = item.type === "mixed" ? "文本+图片" : (item.type === "image" ? "图片" : "文本");
            const textPreview = item.textPreview
                ? `<p class="clipboard-item__text">${escapeHtml(item.textPreview)}</p>`
                : `<p class="clipboard-item__text clipboard-item__text--muted">（无文本内容）</p>`;
            const imagePreview = item.hasImage && item.imageDataUrl
                ? `
                        <div class="clipboard-item__imageWrap">
                            <img class="clipboard-item__image" src="${escapeHtml(item.imageDataUrl)}" alt="clipboard-image-preview" />
                            <span class="clipboard-item__imageMeta">${item.imageWidth || 0} × ${item.imageHeight || 0}</span>
                        </div>
                    `
                : "";
            return `
                <article class="clipboard-item" data-item-id="${escapeHtml(item.id)}">
                    <div class="clipboard-item__head">
                        <div class="clipboard-item__meta">
                            <span class="clipboard-item__type">${escapeHtml(typeLabel)}</span>
                            <span class="clipboard-item__time">${escapeHtml(formatDate(item.createdAt))}</span>
                        </div>
                        <div class="clipboard-item__actions">
                            <button type="button" class="clipboard-item__btn" data-action="copy">复制</button>
                            <button type="button" class="clipboard-item__btn" data-action="pin">${item.pinned ? "取消置顶" : "置顶"}</button>
                            <button type="button" class="clipboard-item__btn clipboard-item__btn--danger" data-action="delete">删除</button>
                        </div>
                    </div>
                    ${textPreview}
                    ${imagePreview}
                </article>
            `;
        }).join("");
        clipboardDom.empty.hidden = items.length > 0;
    });
}

async function refreshSnapshot() {
    await measureAsync("clipboard.refreshSnapshot", async () => {
        if (!window.api?.getClipboardSnapshot || !clipboardDom.live) {
            return;
        }
        try {
            const snapshot = await window.api.getClipboardSnapshot();
            const textStatus = snapshot?.hasText ? "有文本" : "无文本";
            const imageStatus = snapshot?.hasImage ? `有图片(${snapshot.imageWidth || 0}x${snapshot.imageHeight || 0})` : "无图片";
            clipboardDom.live.textContent = `当前剪贴板：${textStatus} / ${imageStatus}`;
        } catch (error) {
            clipboardDom.live.textContent = "当前剪贴板：读取失败";
        }
    });
}

async function refreshHistory() {
    await measureAsync("clipboard.refreshHistory", async () => {
        if (!window.api?.getClipboardHistory) {
            setStatus("当前环境不支持剪贴板历史。");
            return;
        }
        const data = await window.api.getClipboardHistory();
        clipboardState.items = Array.isArray(data?.items) ? data.items : [];
        clipboardState.count = Number(data?.count || 0);
        clipboardState.pinnedCount = Number(data?.pinnedCount || 0);
        renderSummary();
        renderList();
    });
}

async function captureNow(source = "manual") {
    if (!window.api?.captureClipboard) {
        return;
    }
    if (clipboardState.captureInFlight) {
        return;
    }
    clipboardState.captureInFlight = true;
    try {
        const result = await window.api.captureClipboard({source});
        if (result?.reason === "empty") {
            setStatus("剪贴板为空，未记录。");
        } else if (result?.reason === "duplicate") {
            setStatus("重复内容已刷新到顶部。");
        } else if (result?.inserted) {
            setStatus("已记录剪贴板内容。");
        }
        await Promise.all([refreshHistory(), refreshSnapshot()]);
    } finally {
        clipboardState.captureInFlight = false;
    }
}

function stopAutoCapture() {
    if (clipboardState.timer) {
        clearInterval(clipboardState.timer);
        clipboardState.timer = null;
    }
}

function startAutoCapture() {
    stopAutoCapture();
    if (!clipboardState.autoCapture || !clipboardState.active) {
        return;
    }
    clipboardState.timer = setInterval(() => {
        captureNow("auto").catch((error) => {
            console.error(error);
        });
    }, AUTO_CAPTURE_INTERVAL_MS);
}

async function clearHistory() {
    if (!window.api?.clearClipboardHistory) {
        return;
    }
    await window.api.clearClipboardHistory();
    setStatus("历史已清空。");
    await refreshHistory();
    await refreshSnapshot();
}

async function copyItem(id) {
    if (!window.api?.copyClipboardItem) {
        return;
    }
    await window.api.copyClipboardItem(id);
    setStatus("已复制回系统剪贴板。");
    await refreshSnapshot();
}

async function deleteItem(id) {
    if (!window.api?.deleteClipboardItem) {
        return;
    }
    await window.api.deleteClipboardItem(id);
    setStatus("已删除记录。");
    await refreshHistory();
}

async function togglePin(id) {
    if (!window.api?.pinClipboardItem) {
        return;
    }
    const item = clipboardState.items.find((entry) => entry.id === id);
    if (!item) return;
    await window.api.pinClipboardItem(id, item.pinned !== true);
    setStatus(item.pinned ? "已取消置顶。" : "已置顶。");
    await refreshHistory();
}

function setFilter(filter) {
    clipboardState.filter = filter;
    if (clipboardDom.filters) {
        $$("[data-filter]", clipboardDom.filters).forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.filter === filter);
        });
    }
    renderList();
}

function wireEvents() {
    clipboardDom.capture?.addEventListener("click", async () => {
        await captureNow("manual");
    });
    clipboardDom.clear?.addEventListener("click", async () => {
        if (!window.confirm("确定清空全部剪贴板历史吗？")) return;
        await clearHistory();
    });
    clipboardDom.auto?.addEventListener("click", () => {
        clipboardState.autoCapture = !clipboardState.autoCapture;
        saveAutoCapturePreference();
        renderSummary();
        startAutoCapture();
        setStatus(clipboardState.autoCapture ? "自动记录已开启。" : "自动记录已关闭。");
    });
    clipboardDom.search?.addEventListener("input", (event) => {
        clipboardState.query = event.target.value || "";
        if (clipboardState.searchDebounceTimer) {
            clearTimeout(clipboardState.searchDebounceTimer);
        }
        clipboardState.searchDebounceTimer = window.setTimeout(() => {
            clipboardState.searchDebounceTimer = null;
            renderList();
        }, SEARCH_DEBOUNCE_MS);
    });
    clipboardDom.filters?.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-filter]");
        if (!btn) return;
        setFilter(btn.dataset.filter || "all");
    });
    clipboardDom.list?.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-action]");
        const item = event.target.closest("[data-item-id]");
        if (!btn || !item) return;
        const id = item.dataset.itemId;
        if (btn.dataset.action === "copy") {
            await copyItem(id);
            return;
        }
        if (btn.dataset.action === "delete") {
            await deleteItem(id);
            return;
        }
        if (btn.dataset.action === "pin") {
            await togglePin(id);
        }
    });
}

function cacheDom(root) {
    clipboardDom.root = root;
    clipboardDom.list = $('[data-role="clipboard-list"]', root);
    clipboardDom.empty = $('[data-role="clipboard-empty"]', root);
    clipboardDom.status = $('[data-role="clipboard-status"]', root);
    clipboardDom.total = $('[data-role="clipboard-total"]', root);
    clipboardDom.pinned = $('[data-role="clipboard-pinned"]', root);
    clipboardDom.live = $('[data-role="clipboard-live"]', root);
    clipboardDom.search = $('[data-role="clipboard-search"]', root);
    clipboardDom.capture = $('[data-role="clipboard-capture"]', root);
    clipboardDom.clear = $('[data-role="clipboard-clear"]', root);
    clipboardDom.auto = $('[data-role="clipboard-auto"]', root);
    clipboardDom.filters = $('[data-role="clipboard-filters"]', root);
}

function buildClipboardMarkup() {
    return `
        <section class="clipboard-card">
            <header class="clipboard-head">
                <div>
                    <h3 class="clipboard-title">剪贴板管理器</h3>
                    <p class="clipboard-desc">参考 CopyQ、Maccy 常见交互：快速检索、固定置顶、单击回填。</p>
                </div>
                <div class="clipboard-actions">
                    <button type="button" class="clipboard-btn" data-role="clipboard-capture">立即捕获</button>
                    <button type="button" class="clipboard-btn" data-role="clipboard-auto">自动记录：关</button>
                    <button type="button" class="clipboard-btn clipboard-btn--danger" data-role="clipboard-clear">清空历史</button>
                </div>
            </header>
            <div class="clipboard-toolbar">
                <div class="clipboard-stats">
                    <span class="clipboard-pill">总数 <strong data-role="clipboard-total">0</strong></span>
                    <span class="clipboard-pill">置顶 <strong data-role="clipboard-pinned">0</strong></span>
                </div>
                <p class="clipboard-live" data-role="clipboard-live">当前剪贴板：读取中...</p>
            </div>
            <div class="clipboard-controls">
                <label class="clipboard-searchWrap">
                    <input class="clipboard-search" data-role="clipboard-search" placeholder="搜索文本内容..." />
                </label>
                <div class="clipboard-filters" data-role="clipboard-filters">
                    <button type="button" class="clipboard-filter is-active" data-filter="all">全部</button>
                    <button type="button" class="clipboard-filter" data-filter="text">文本</button>
                    <button type="button" class="clipboard-filter" data-filter="image">图片</button>
                    <button type="button" class="clipboard-filter" data-filter="pinned">置顶</button>
                </div>
            </div>
            <p class="clipboard-status" data-role="clipboard-status">就绪。</p>
            <div class="clipboard-list" data-role="clipboard-list"></div>
            <div class="clipboard-empty" data-role="clipboard-empty" hidden>暂无记录，点击“立即捕获”开始。</div>
        </section>
    `;
}

async function syncAll() {
    await measureAsync("clipboard.syncAll", async () => {
        await Promise.all([refreshHistory(), refreshSnapshot()]);
        clipboardState.lastSyncedAt = Date.now();
    });
}

function mountClipboardView() {
    if (clipboardState.mounted) {
        return;
    }
    const root = document.querySelector(".clipboard-root");
    if (!root) {
        return;
    }
    root.innerHTML = buildClipboardMarkup();
    cacheDom(root);
    clipboardState.autoCapture = loadAutoCapturePreference();
    clipboardState.standalone = !document.querySelector("nav.shell__nav");
    clipboardState.active = clipboardState.standalone || document.querySelector('.view[data-view="clipboard"]')?.classList.contains("is-active") === true;
    setFilter("all");
    wireEvents();
    clipboardState.mounted = true;
    renderSummary();
    syncAll().catch((error) => {
        console.error(error);
        setStatus(`加载失败：${error?.message || error}`);
    });
    startAutoCapture();
}

function wireShellViewChanges() {
    window.addEventListener("shell:viewchange", (event) => {
        const viewKey = event.detail?.viewKey || "";
        clipboardState.active = viewKey === "clipboard";
        if (clipboardState.active) {
            if (clipboardState.syncTimer) {
                clearTimeout(clipboardState.syncTimer);
                clipboardState.syncTimer = null;
            }
            const dueToStale = Date.now() - clipboardState.lastSyncedAt >= CLIPBOARD_SYNC_THROTTLE_MS;
            if (dueToStale) {
                clipboardState.syncTimer = window.setTimeout(() => {
                    clipboardState.syncTimer = null;
                    syncAll().catch((error) => console.error(error));
                }, VIEW_TRANSITION_MS);
            }
        }
        startAutoCapture();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    mountClipboardView();
    wireShellViewChanges();
});
