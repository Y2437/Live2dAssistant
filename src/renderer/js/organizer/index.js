import { marked } from "../../vendor/marked/lib/marked.esm.js";
import hljs from "../../vendor/highlight-lite.mjs";
import { $, escapeHtml } from "../shared/dom.js";
import {
    buildMarkdownOutline,
    categoryLabel,
    formatSize,
    formatTime,
    getLanguageFromExt,
} from "./utils.js";

hljs.registerLanguage("javascript");
hljs.registerLanguage("js");
hljs.registerLanguage("typescript");
hljs.registerLanguage("ts");
hljs.registerLanguage("json");
hljs.registerLanguage("html");
hljs.registerLanguage("xml");
hljs.registerLanguage("css");
hljs.registerLanguage("markdown");
hljs.registerLanguage("md");
hljs.registerLanguage("bash");
hljs.registerLanguage("sh");
hljs.registerLanguage("python");
hljs.registerLanguage("py");

const SORT_OPTIONS = [
    { key: "recent", label: "Recently updated" },
    { key: "name", label: "File name" },
    { key: "size", label: "File size" },
];

const state = {
    items: [],
    visibleItems: [],
    selectedPath: "",
    selectedLibrary: "all",
    selectedCategory: "all",
    query: "",
    updatedAt: "",
    stats: null,
    sortKey: "recent",
    searchMeta: null,
    previewFile: null,
    previewLoading: false,
    previewRequestId: 0,
    previewTab: "read",
    outlineItems: [],
    outlineVisible: false,
};

const dom = {
    slot: $('[data-slot="organizer"]'),
    root: null,
    search: null,
    sort: null,
    reset: null,
    status: null,
    summary: null,
    libraries: null,
    categories: null,
    resultMeta: null,
    list: null,
    previewTitle: null,
    previewMeta: null,
    previewBody: null,
    previewControls: null,
    outline: null,
};

marked.setOptions({
    breaks: true,
    gfm: true,
});

function getLibraryKey(item) {
    return String(item?.root || "").trim() || "(default)";
}

function getLibraryLabel(libraryKey) {
    const parts = String(libraryKey || "").split(/[\\/]/).filter(Boolean);
    return parts.pop() || libraryKey || "(default)";
}

function buildLibraryItems(items) {
    const counts = new Map();
    items.forEach((item) => {
        const key = getLibraryKey(item);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [{ key: "all", label: "All libraries", hint: "", count: items.length }]
        .concat([...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([key, count]) => ({
                key,
                label: getLibraryLabel(key),
                hint: key,
                count,
            })));
}

function buildCategoryItems(items) {
    const counts = new Map();
    items.forEach((item) => {
        const key = item.category || "other";
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [{ key: "all", label: categoryLabel("all"), count: items.length }]
        .concat([...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([key, count]) => ({ key, label: categoryLabel(key), count })));
}

function sortItems(items) {
    const next = [...items];
    if (state.sortKey === "name") {
        next.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        return next;
    }
    if (state.sortKey === "size") {
        next.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0));
        return next;
    }
    next.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0));
    return next;
}

function getLibraryScopedItems() {
    if (state.selectedLibrary === "all") {
        return state.items;
    }
    return state.items.filter((item) => getLibraryKey(item) === state.selectedLibrary);
}

function buildScopedItems() {
    const source = state.searchMeta?.items?.length ? state.searchMeta.items : getLibraryScopedItems();
    let items = source;
    if (state.selectedCategory !== "all") {
        items = items.filter((item) => (item.category || "other") === state.selectedCategory);
    }
    state.visibleItems = sortItems(items);
    return state.visibleItems;
}

function renderSummary() {
    if (!dom.summary) return;
    const libraryScopedItems = getLibraryScopedItems();
    const issues = libraryScopedItems.filter((item) => item.status === "error" || item.status === "oversize").length;
    const chunkCount = libraryScopedItems.reduce((sum, item) => sum + (item.chunkCount || 0), 0);
    dom.summary.innerHTML = `
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Files</span>
            <strong class="organizer-statCard__value">${libraryScopedItems.length}</strong>
            <span class="organizer-statCard__hint">Current library scope</span>
        </article>
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Chunks</span>
            <strong class="organizer-statCard__value">${chunkCount}</strong>
            <span class="organizer-statCard__hint">Indexed text slices</span>
        </article>
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Issues</span>
            <strong class="organizer-statCard__value">${issues}</strong>
            <span class="organizer-statCard__hint">Errors and oversize files</span>
        </article>
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Updated</span>
            <strong class="organizer-statCard__value">${state.updatedAt ? formatTime(state.updatedAt) : "-"}</strong>
            <span class="organizer-statCard__hint">Index timestamp</span>
        </article>
    `;
}

function renderLibraries() {
    if (!dom.libraries) return;
    const items = buildLibraryItems(state.items);
    dom.libraries.innerHTML = items.map((item) => `
        <button type="button" class="organizer-filterChip organizer-filterChip--library${state.selectedLibrary === item.key ? " is-active" : ""}" data-library="${escapeHtml(item.key)}">
            <span class="organizer-filterChip__stack">
                <span class="organizer-filterChip__label">${escapeHtml(item.label)}</span>
                ${item.hint && item.key !== "all" ? `<span class="organizer-filterChip__hint">${escapeHtml(item.hint)}</span>` : ""}
            </span>
            <span>${item.count}</span>
        </button>
    `).join("");
}

function renderCategories() {
    if (!dom.categories) return;
    const items = buildCategoryItems(getLibraryScopedItems());
    dom.categories.innerHTML = items.map((item) => `
        <button type="button" class="organizer-filterChip${state.selectedCategory === item.key ? " is-active" : ""}" data-category="${escapeHtml(item.key)}">
            <span>${escapeHtml(item.label)}</span>
            <span>${item.count}</span>
        </button>
    `).join("");
}

function renderStatus() {
    if (!dom.status) return;
    const query = state.query.trim();
    const mode = query ? "Searching" : "Browsing";
    const count = state.visibleItems.length;
    const libraryLabel = state.selectedLibrary === "all" ? "all libraries" : getLibraryLabel(state.selectedLibrary);
    const suffix = query ? ` for \"${query}\"` : "";
    dom.status.textContent = `${mode} ${count} file${count === 1 ? "" : "s"} in ${libraryLabel}${suffix}`;
}

function renderResultMeta() {
    if (!dom.resultMeta) return;
    const sortLabel = SORT_OPTIONS.find((item) => item.key === state.sortKey)?.label || SORT_OPTIONS[0].label;
    const parts = [
        `${state.visibleItems.length} results`,
        `sorted by ${sortLabel.toLowerCase()}`,
        state.updatedAt ? `updated ${formatTime(state.updatedAt)}` : "",
    ].filter(Boolean);
    dom.resultMeta.textContent = parts.join(" · ");
}

function buildResultExcerpt(item) {
    if (Array.isArray(item.matches) && item.matches.length && item.matches[0]?.preview) {
        return item.matches[0].preview;
    }
    return item.excerpt || "No summary available.";
}

function renderFileList() {
    if (!dom.list) return;
    buildScopedItems();
    renderStatus();
    renderResultMeta();
    if (!state.visibleItems.length) {
        dom.list.innerHTML = `
            <article class="organizer-emptyState">
                <h3>No files found</h3>
                <p>Try another keyword or switch to another library.</p>
            </article>
        `;
        return;
    }
    dom.list.innerHTML = state.visibleItems.map((item) => `
        <button type="button" class="organizer-resultCard${state.selectedPath === item.relativePath ? " is-active" : ""}" data-file-path="${escapeHtml(item.relativePath)}">
            <div class="organizer-resultCard__head">
                <div class="organizer-resultCard__copy">
                    <h3 class="organizer-resultCard__title">${escapeHtml(item.name || item.relativePath)}</h3>
                    <p class="organizer-resultCard__path">${escapeHtml(item.relativePath)}</p>
                </div>
                <span class="organizer-resultCard__ext">${escapeHtml(String(item.ext || "").replace(/^\./, "") || "file")}</span>
            </div>
            <div class="organizer-resultCard__meta">
                <span class="organizer-pill">${escapeHtml(categoryLabel(item.category || "other"))}</span>
                <span class="organizer-pill">${escapeHtml(item.status || "ready")}</span>
                ${item.chunkCount ? `<span class="organizer-pill">${escapeHtml(String(item.chunkCount))} chunks</span>` : ""}
                ${Number.isFinite(Number(item.score)) ? `<span class="organizer-pill">score ${escapeHtml(String(item.score))}</span>` : ""}
            </div>
            <p class="organizer-resultCard__excerpt">${escapeHtml(buildResultExcerpt(item))}</p>
        </button>
    `).join("");
}

function renderOutline() {
    if (!dom.outline) return;
    if (!state.outlineVisible || !state.outlineItems.length) {
        dom.outline.hidden = true;
        dom.outline.innerHTML = "";
        return;
    }
    dom.outline.hidden = false;
    dom.outline.innerHTML = state.outlineItems.map((item) => `
        <button type="button" class="organizer-outlineItem" data-outline-id="${escapeHtml(item.id)}" style="--outline-level:${item.level}">
            ${escapeHtml(item.text)}
        </button>
    `).join("");
}

function renderPreviewControls() {
    if (!dom.previewControls) return;
    const file = state.previewFile;
    if (!file) {
        dom.previewControls.innerHTML = "";
        renderOutline();
        return;
    }
    const buttons = [];
    if (file.mode === "pdf") {
        buttons.push(`<button type="button" class="organizer-previewToggle${state.previewTab === "read" ? " is-active" : ""}" data-preview-tab="read">Read</button>`);
        buttons.push(`<button type="button" class="organizer-previewToggle${state.previewTab === "source" ? " is-active" : ""}" data-preview-tab="source">Source</button>`);
    }
    if (state.outlineItems.length) {
        buttons.push(`<button type="button" class="organizer-previewToggle${state.outlineVisible ? " is-active" : ""}" data-preview-action="toggle-outline">${state.outlineVisible ? "Hide outline" : "Show outline"}</button>`);
    }
    dom.previewControls.innerHTML = buttons.join("");
    renderOutline();
}

function renderPreviewEmpty(title = "Select a file", desc = "Choose a result from the middle column to start reading.") {
    state.outlineItems = [];
    state.outlineVisible = false;
    if (dom.previewTitle) {
        dom.previewTitle.textContent = title;
    }
    if (dom.previewMeta) {
        dom.previewMeta.textContent = "";
    }
    if (dom.previewBody) {
        dom.previewBody.innerHTML = `
            <article class="organizer-emptyState organizer-emptyState--preview">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(desc)}</p>
            </article>
        `;
    }
    renderPreviewControls();
}

function renderMarkdownPreview(file) {
    state.outlineItems = buildMarkdownOutline(file.content);
    const html = marked.parse(file.content || "");
    dom.previewBody.innerHTML = `<div class="organizer-markdown">${html}</div>`;
    const headings = dom.previewBody.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headings.forEach((heading, index) => {
        if (state.outlineItems[index]) {
            heading.id = state.outlineItems[index].id;
        }
    });
    renderPreviewControls();
}

function renderCodePreview(file) {
    state.outlineItems = [];
    const language = getLanguageFromExt(file.ext);
    const source = String(file.content || "");
    let html = "";
    try {
        html = hljs.highlight(source, { language }).value;
    } catch (error) {
        html = hljs.highlightAuto(source).value;
    }
    dom.previewBody.innerHTML = `<pre class="organizer-code"><code class="hljs ${escapeHtml(language)}">${html}</code></pre>`;
    renderPreviewControls();
}

function renderTextPreview(file) {
    state.outlineItems = [];
    dom.previewBody.innerHTML = `<pre class="organizer-plainText">${escapeHtml(file.content || "")}</pre>`;
    renderPreviewControls();
}

function renderPdfPreview(file) {
    state.outlineItems = [];
    if (state.previewTab === "source") {
        const src = `file:///${String(file.fullPath || "").replace(/\\/g, "/")}`;
        dom.previewBody.innerHTML = `<iframe class="organizer-pdf" src="${encodeURI(src)}" title="${escapeHtml(file.path || "")}"></iframe>`;
        renderPreviewControls();
        return;
    }
    const matches = Array.isArray(file.matches) ? file.matches : [];
    dom.previewBody.innerHTML = `
        <section class="organizer-pdfRead">
            <article class="organizer-previewBlock">
                <h3 class="organizer-previewBlock__title">Extracted text</h3>
                <pre class="organizer-plainText organizer-plainText--pdf">${escapeHtml(file.content || file.textError || "No readable text extracted.")}</pre>
            </article>
            <article class="organizer-previewBlock">
                <h3 class="organizer-previewBlock__title">Indexed matches</h3>
                <div class="organizer-matchList">
                    ${matches.length
        ? matches.map((match) => `
                            <article class="organizer-matchCard">
                                <span class="organizer-matchCard__label">${escapeHtml(match.chunkId || "match")}</span>
                                <p class="organizer-matchCard__text">${escapeHtml(match.preview || "")}</p>
                            </article>
                        `).join("")
        : '<p class="organizer-matchList__empty">No indexed match snippets available.</p>'}
                </div>
            </article>
        </section>
    `;
    renderPreviewControls();
}

function renderBinaryPreview(file) {
    state.outlineItems = [];
    dom.previewBody.innerHTML = `
        <article class="organizer-emptyState organizer-emptyState--preview">
            <h3>Preview unavailable</h3>
            <p>${escapeHtml(file.content || `This ${file.ext || "binary"} file cannot be previewed here.`)}</p>
        </article>
    `;
    renderPreviewControls();
}

function renderPreview(file = state.previewFile) {
    if (!file) {
        renderPreviewEmpty();
        return;
    }
    if (dom.previewTitle) {
        dom.previewTitle.textContent = file.path || file.relativePath || file.name || "Preview";
    }
    if (dom.previewMeta) {
        const parts = [
            file.category ? categoryLabel(file.category) : "",
            file.mode || "",
            Number.isFinite(Number(file.size)) ? formatSize(file.size) : "",
            file.chunkCount ? `${file.chunkCount} chunks` : "",
            file.status || "",
        ].filter(Boolean);
        dom.previewMeta.textContent = parts.join(" · ");
    }
    if (state.previewLoading) {
        dom.previewBody.innerHTML = '<div class="organizer-loading">Loading preview...</div>';
        state.outlineItems = [];
        renderPreviewControls();
        return;
    }
    if (file.mode === "pdf") {
        renderPdfPreview(file);
        return;
    }
    if (file.mode !== "text") {
        renderBinaryPreview(file);
        return;
    }
    if (/\.(md|markdown)$/i.test(file.ext || "")) {
        renderMarkdownPreview(file);
        return;
    }
    if (/\.(txt|log)$/i.test(file.ext || "")) {
        renderTextPreview(file);
        return;
    }
    renderCodePreview(file);
}

async function openFile(filePath) {
    if (!window.api?.readAgentLibraryFile) {
        return;
    }
    state.selectedPath = filePath;
    state.previewTab = "read";
    state.outlineVisible = false;
    state.previewLoading = true;
    const requestId = state.previewRequestId + 1;
    state.previewRequestId = requestId;
    const fallback = state.visibleItems.find((item) => item.relativePath === filePath) || null;
    state.previewFile = fallback;
    renderFileList();
    renderPreview();
    try {
        const file = await window.api.readAgentLibraryFile(filePath);
        if (requestId !== state.previewRequestId) {
            return;
        }
        state.previewFile = file;
    } catch (error) {
        if (requestId !== state.previewRequestId) {
            return;
        }
        state.previewFile = {
            ...(fallback || {}),
            path: filePath,
            mode: "binary",
            ext: fallback?.ext || "",
            content: error?.message || String(error),
            status: "error",
        };
    } finally {
        if (requestId === state.previewRequestId) {
            state.previewLoading = false;
            renderFileList();
            renderPreview();
        }
    }
}

async function syncPreviewSelection() {
    buildScopedItems();
    if (!state.visibleItems.length) {
        state.selectedPath = "";
        state.previewFile = null;
        renderPreviewEmpty("No matching files", "Try another keyword or switch to another library.");
        return;
    }
    if (!state.visibleItems.some((item) => item.relativePath === state.selectedPath)) {
        state.selectedPath = state.visibleItems[0].relativePath;
    }
    await openFile(state.selectedPath);
}

function renderAll() {
    renderSummary();
    renderLibraries();
    renderCategories();
    renderFileList();
    if (!state.previewFile && !state.previewLoading) {
        renderPreview();
    }
}

function applyLocalSearch(items, query) {
    const normalized = query.toLowerCase();
    return items.filter((item) => {
        const haystack = `${item.relativePath}\n${item.name}\n${item.excerpt || ""}`.toLowerCase();
        return haystack.includes(normalized);
    });
}

async function applySearch() {
    const query = String(dom.search?.value || "").trim();
    state.query = query;
    if (!query) {
        state.searchMeta = null;
        renderAll();
        await syncPreviewSelection();
        return;
    }
    if (!window.api?.searchAgentLibrary) {
        state.searchMeta = { items: applyLocalSearch(getLibraryScopedItems(), query) };
        renderAll();
        await syncPreviewSelection();
        return;
    }
    try {
        const result = await window.api.searchAgentLibrary(query);
        const items = Array.isArray(result?.items)
            ? result.items.map((item) => {
                const relativePath = item.path || item.relativePath;
                const sourceItem = state.items.find((entry) => entry.relativePath === relativePath);
                return {
                    ...item,
                    relativePath,
                    name: item.name || String(relativePath || "").split("/").pop() || "",
                    category: item.category || sourceItem?.category || "other",
                    root: sourceItem?.root || "",
                    size: item.size || sourceItem?.size || 0,
                    mtimeMs: item.mtimeMs || sourceItem?.mtimeMs || 0,
                };
            })
            : [];
        state.searchMeta = {
            ...result,
            items,
        };
        renderAll();
        await syncPreviewSelection();
    } catch (error) {
        console.error(error);
        if (dom.status) {
            dom.status.textContent = `Search failed: ${error?.message || error}`;
        }
    }
}

function debounce(fn, wait = 180) {
    let timer = null;
    return (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), wait);
    };
}

async function loadIndex() {
    if (!window.api?.getAgentLibraryIndex) {
        return;
    }
    const data = await window.api.getAgentLibraryIndex();
    state.items = Array.isArray(data?.items) ? data.items : [];
    state.updatedAt = data?.updatedAt || "";
    state.stats = data?.stats || null;
    state.searchMeta = null;
    renderAll();
    await syncPreviewSelection();
}

function createLayout() {
    if (!dom.slot || dom.root) {
        return;
    }
    const hostCard = dom.slot.closest(".placeholder-card");
    if (hostCard) {
        hostCard.classList.add("organizer-host");
    }
    const root = document.createElement("section");
    root.className = "organizer-app";
    root.innerHTML = `
        <header class="organizer-topbar">
            <div class="organizer-topbar__copy">
                <p class="organizer-topbar__eyebrow">Library workspace</p>
                <h3 class="organizer-topbar__title">资料库</h3>
                <p class="organizer-topbar__desc">先选资料库，再在库内检索，最后在右侧阅读正文。</p>
            </div>
            <div class="organizer-topbar__spacer" aria-hidden="true"></div>
            <div class="organizer-toolbarStatus" data-role="organizer-status">Loading library index...</div>
        </header>
        <div class="organizer-workspace">
            <aside class="organizer-sidebar">
                <section class="organizer-panel organizer-panel--libraries">
                    <div class="organizer-panel__head">
                        <h4>Libraries</h4>
                    </div>
                    <div class="organizer-filterGrid organizer-filterGrid--libraries" data-role="organizer-libraries"></div>
                </section>
                <section class="organizer-panel organizer-panel--summary">
                    <div class="organizer-panel__head">
                        <h4>Overview</h4>
                    </div>
                    <div class="organizer-statGrid" data-role="organizer-summary"></div>
                </section>
                <section class="organizer-panel organizer-panel--filters">
                    <div class="organizer-panel__head">
                        <h4>Categories</h4>
                    </div>
                    <div class="organizer-filterGrid" data-role="organizer-categories"></div>
                </section>
            </aside>
            <section class="organizer-panel organizer-panel--results">
                <div class="organizer-panel__head organizer-panel__head--results">
                    <div class="organizer-panel__heading">
                        <h4>Search</h4>
                        <span class="organizer-panel__meta" data-role="organizer-result-meta"></span>
                    </div>
                    <div class="organizer-toolbar">
                        <label class="organizer-searchField">
                            <span class="organizer-searchField__label">Search current library</span>
                            <input class="organizer-searchField__input" data-role="organizer-search" type="search" placeholder="Search files, excerpts, and indexed content" autocomplete="off" spellcheck="false" />
                        </label>
                        <label class="organizer-sortField">
                            <span class="organizer-sortField__label">Sort</span>
                            <select class="organizer-sortField__select" data-role="organizer-sort">
                                ${SORT_OPTIONS.map((item) => `<option value="${item.key}">${item.label}</option>`).join("")}
                            </select>
                        </label>
                        <button type="button" class="organizer-toolbarBtn" data-role="organizer-reset">Reset filters</button>
                    </div>
                </div>
                <div class="organizer-resultList" data-role="organizer-file-list"></div>
            </section>
            <section class="organizer-panel organizer-panel--preview">
                <div class="organizer-previewHead">
                    <div class="organizer-previewHead__copy">
                        <h4 class="organizer-previewHead__title" data-role="organizer-preview-title">Select a file</h4>
                        <p class="organizer-previewHead__meta" data-role="organizer-preview-meta"></p>
                    </div>
                    <div class="organizer-previewHead__actions" data-role="organizer-preview-controls"></div>
                </div>
                <div class="organizer-previewLayout">
                    <article class="organizer-previewBody" data-role="organizer-preview-body"></article>
                    <aside class="organizer-outline" data-role="organizer-outline" hidden></aside>
                </div>
            </section>
        </div>
    `;

    dom.slot.replaceChildren(root);
    dom.root = root;
    dom.search = $('[data-role="organizer-search"]', root);
    dom.sort = $('[data-role="organizer-sort"]', root);
    dom.reset = $('[data-role="organizer-reset"]', root);
    dom.status = $('[data-role="organizer-status"]', root);
    dom.summary = $('[data-role="organizer-summary"]', root);
    dom.libraries = $('[data-role="organizer-libraries"]', root);
    dom.categories = $('[data-role="organizer-categories"]', root);
    dom.resultMeta = $('[data-role="organizer-result-meta"]', root);
    dom.list = $('[data-role="organizer-file-list"]', root);
    dom.previewTitle = $('[data-role="organizer-preview-title"]', root);
    dom.previewMeta = $('[data-role="organizer-preview-meta"]', root);
    dom.previewBody = $('[data-role="organizer-preview-body"]', root);
    dom.previewControls = $('[data-role="organizer-preview-controls"]', root);
    dom.outline = $('[data-role="organizer-outline"]', root);
}

function resetFilters() {
    state.selectedLibrary = "all";
    state.selectedCategory = "all";
    state.query = "";
    state.searchMeta = null;
    if (dom.search) {
        dom.search.value = "";
    }
    if (dom.sort) {
        dom.sort.value = state.sortKey;
    }
}

function wireEvents() {
    if (!dom.root) return;
    const onSearch = debounce(() => {
        applySearch().catch(console.error);
    });
    dom.search?.addEventListener("input", onSearch);
    dom.sort?.addEventListener("change", async (event) => {
        state.sortKey = event.target.value || "recent";
        renderFileList();
        await syncPreviewSelection();
    });
    dom.reset?.addEventListener("click", async () => {
        resetFilters();
        renderAll();
        await syncPreviewSelection();
    });
    dom.libraries?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-library]");
        if (!button) return;
        state.selectedLibrary = button.dataset.library || "all";
        state.selectedCategory = "all";
        state.searchMeta = null;
        renderAll();
        await syncPreviewSelection();
    });
    dom.categories?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-category]");
        if (!button) return;
        state.selectedCategory = button.dataset.category || "all";
        renderAll();
        await syncPreviewSelection();
    });
    dom.list?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-file-path]");
        if (!button) return;
        await openFile(button.dataset.filePath);
    });
    dom.previewControls?.addEventListener("click", (event) => {
        const tabButton = event.target.closest("[data-preview-tab]");
        if (tabButton) {
            state.previewTab = tabButton.dataset.previewTab || "read";
            renderPreview();
            return;
        }
        const actionButton = event.target.closest("[data-preview-action='toggle-outline']");
        if (actionButton) {
            state.outlineVisible = !state.outlineVisible;
            renderPreviewControls();
        }
    });
    dom.outline?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-outline-id]");
        if (!button) return;
        const target = dom.previewBody?.querySelector(`#${CSS.escape(button.dataset.outlineId)}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    window.addEventListener("organizer:refresh", async () => {
        await loadIndex();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    createLayout();
    wireEvents();
    await loadIndex();
});

