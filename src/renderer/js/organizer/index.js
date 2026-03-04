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
    currentView: "libraries",
    items: [],
    visibleItems: [],
    selectedPath: "",
    selectedLibrary: "",
    selectedCategory: "all",
    selectedDirectory: "",
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
    collapsedCategories: new Set(),
    collapsedDirectories: new Set(),
};

const dom = {
    slot: $('[data-slot="organizer"]'),
    root: null,
    status: null,
    libraryGrid: null,
    summary: null,
    categories: null,
    tree: null,
    search: null,
    sort: null,
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

function getCurrentLibraryItems() {
    if (!state.selectedLibrary) {
        return [];
    }
    return state.items.filter((item) => getLibraryKey(item) === state.selectedLibrary);
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

function buildLibraryCards(items) {
    const libraries = new Map();
    items.forEach((item) => {
        const key = getLibraryKey(item);
        if (!libraries.has(key)) {
            libraries.set(key, {
                key,
                label: getLibraryLabel(key),
                hint: key,
                fileCount: 0,
                chunkCount: 0,
                issueCount: 0,
                recentAt: "",
                categories: new Map(),
            });
        }
        const entry = libraries.get(key);
        entry.fileCount += 1;
        entry.chunkCount += Number(item.chunkCount) || 0;
        if (item.status === "error" || item.status === "oversize") {
            entry.issueCount += 1;
        }
        const category = item.category || "other";
        entry.categories.set(category, (entry.categories.get(category) || 0) + 1);
        if (!entry.recentAt || Number(item.mtimeMs) > Number(new Date(entry.recentAt).getTime() || 0)) {
            entry.recentAt = item.updatedAt || item.mtime || item.modifiedAt || "";
        }
    });
    return [...libraries.values()]
        .sort((a, b) => b.fileCount - a.fileCount || a.label.localeCompare(b.label))
        .map((entry) => ({
            ...entry,
            categoryLabels: [...entry.categories.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .slice(0, 3)
                .map(([key, count]) => `${categoryLabel(key)} ${count}`),
        }));
}

function buildCategoryGroups(items) {
    const groups = new Map();
    items.forEach((item) => {
        const key = item.category || "other";
        if (!groups.has(key)) {
            groups.set(key, { key, label: categoryLabel(key), items: [] });
        }
        groups.get(key).items.push(item);
    });
    return [...groups.values()]
        .map((group) => ({
            ...group,
            items: sortItems(group.items),
        }))
        .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
}

function buildDirectoryTree(items) {
    const root = { id: "", name: "", dirs: new Map(), files: [] };
    items.forEach((item) => {
        const parts = String(item.relativePath || "").split("/").filter(Boolean);
        let cursor = root;
        let currentPath = "";
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            const isFile = index === parts.length - 1;
            if (isFile) {
                cursor.files.push(item);
                return;
            }
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (!cursor.dirs.has(part)) {
                cursor.dirs.set(part, {
                    id: currentPath,
                    name: part,
                    dirs: new Map(),
                    files: [],
                });
            }
            cursor = cursor.dirs.get(part);
        }
    });
    return root;
}

function buildScopedItems() {
    const source = state.searchMeta ? state.searchMeta.items : getCurrentLibraryItems();
    let items = source;
    if (state.selectedCategory !== "all") {
        items = items.filter((item) => (item.category || "other") === state.selectedCategory);
    }
    if (state.selectedDirectory) {
        items = items.filter((item) => item.relativePath === state.selectedDirectory || item.relativePath.startsWith(`${state.selectedDirectory}/`));
    }
    state.visibleItems = sortItems(items);
    return state.visibleItems;
}

function getResultStatusText() {
    if (state.currentView === "libraries") {
        const libraryCount = buildLibraryCards(state.items).length;
        return `Indexed ${libraryCount} libraries, ${state.items.length} files`;
    }
    const libraryLabel = getLibraryLabel(state.selectedLibrary);
    const parts = [`${state.visibleItems.length} file${state.visibleItems.length === 1 ? "" : "s"}`, `in ${libraryLabel}`];
    if (state.query.trim()) {
        parts.push(`for "${state.query.trim()}"`);
    }
    if (state.selectedCategory !== "all") {
        parts.push(`category ${categoryLabel(state.selectedCategory)}`);
    }
    if (state.selectedDirectory) {
        parts.push(`folder ${state.selectedDirectory}`);
    }
    return parts.join(" ");
}

function renderStatus() {
    if (!dom.status) return;
    dom.status.textContent = getResultStatusText();
}

function updateDomRefs() {
    dom.status = $('[data-role="organizer-status"]', dom.root);
    dom.libraryGrid = $('[data-role="organizer-library-grid"]', dom.root);
    dom.summary = $('[data-role="organizer-summary"]', dom.root);
    dom.categories = $('[data-role="organizer-categories"]', dom.root);
    dom.tree = $('[data-role="organizer-tree"]', dom.root);
    dom.search = $('[data-role="organizer-search"]', dom.root);
    dom.sort = $('[data-role="organizer-sort"]', dom.root);
    dom.resultMeta = $('[data-role="organizer-result-meta"]', dom.root);
    dom.list = $('[data-role="organizer-file-list"]', dom.root);
    dom.previewTitle = $('[data-role="organizer-preview-title"]', dom.root);
    dom.previewMeta = $('[data-role="organizer-preview-meta"]', dom.root);
    dom.previewBody = $('[data-role="organizer-preview-body"]', dom.root);
    dom.previewControls = $('[data-role="organizer-preview-controls"]', dom.root);
    dom.outline = $('[data-role="organizer-outline"]', dom.root);
}

function renderShell() {
    if (!dom.root) return;
    const title = state.currentView === "libraries" ? "资料库" : getLibraryLabel(state.selectedLibrary);
    const desc = state.currentView === "libraries"
        ? "先选择资料库，再进入分类、目录和正文阅读工作台。"
        : "在资料库内部展开分类和目录，再从右侧连续阅读正文。";
    dom.root.innerHTML = `
        <header class="organizer-topbar">
            <div class="organizer-topbar__copy">
                <p class="organizer-topbar__eyebrow">Library workspace</p>
                <h3 class="organizer-topbar__title">${escapeHtml(title)}</h3>
                <p class="organizer-topbar__desc">${escapeHtml(desc)}</p>
            </div>
            <div class="organizer-topbar__actions">
                ${state.currentView === "detail" ? '<button type="button" class="organizer-toolbarBtn organizer-toolbarBtn--ghost" data-action="back-to-libraries">返回资料库列表</button>' : ""}
            </div>
            <div class="organizer-toolbarStatus" data-role="organizer-status"></div>
        </header>
        ${state.currentView === "libraries" ? `
            <section class="organizer-libraryHub">
                <section class="organizer-libraryHero">
                    <article class="organizer-heroMetric">
                        <span class="organizer-heroMetric__label">Libraries</span>
                        <strong class="organizer-heroMetric__value">${buildLibraryCards(state.items).length}</strong>
                    </article>
                    <article class="organizer-heroMetric">
                        <span class="organizer-heroMetric__label">Files</span>
                        <strong class="organizer-heroMetric__value">${state.items.length}</strong>
                    </article>
                    <article class="organizer-heroMetric">
                        <span class="organizer-heroMetric__label">Chunks</span>
                        <strong class="organizer-heroMetric__value">${state.items.reduce((sum, item) => sum + (item.chunkCount || 0), 0)}</strong>
                    </article>
                    <article class="organizer-heroMetric">
                        <span class="organizer-heroMetric__label">Updated</span>
                        <strong class="organizer-heroMetric__value">${state.updatedAt ? escapeHtml(formatTime(state.updatedAt)) : "-"}</strong>
                    </article>
                </section>
                <section class="organizer-libraryGrid" data-role="organizer-library-grid"></section>
            </section>
        ` : `
            <section class="organizer-detailWorkspace">
                <aside class="organizer-detailRail">
                    <section class="organizer-panel organizer-panel--summary">
                        <div class="organizer-panel__head">
                            <h4>Overview</h4>
                        </div>
                        <div class="organizer-statGrid" data-role="organizer-summary"></div>
                    </section>
                    <section class="organizer-panel organizer-panel--categories">
                        <div class="organizer-panel__head">
                            <div class="organizer-panel__heading">
                                <h4>Categories</h4>
                                <span class="organizer-panel__meta">分类支持展开、折叠和快速定位。</span>
                            </div>
                            ${state.selectedCategory !== "all" ? '<button type="button" class="organizer-miniAction" data-action="clear-category">全部</button>' : ""}
                        </div>
                        <div class="organizer-categoryBrowser" data-role="organizer-categories"></div>
                    </section>
                </aside>
                <section class="organizer-detailCenter">
                    <section class="organizer-panel organizer-panel--toolbar">
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
                                <button type="button" class="organizer-toolbarBtn" data-action="reset-filters">重置筛选</button>
                            </div>
                        </div>
                    </section>
                    <section class="organizer-panel organizer-panel--tree">
                        <div class="organizer-panel__head">
                            <div class="organizer-panel__heading">
                                <h4>Directory</h4>
                                <span class="organizer-panel__meta">目录支持展开、折叠和文件直达。</span>
                            </div>
                            ${state.selectedDirectory ? '<button type="button" class="organizer-miniAction" data-action="clear-directory">全部</button>' : ""}
                        </div>
                        <div class="organizer-tree" data-role="organizer-tree"></div>
                    </section>
                    <section class="organizer-panel organizer-panel--results">
                        <div class="organizer-panel__head">
                            <div class="organizer-panel__heading">
                                <h4>Files</h4>
                                <span class="organizer-panel__meta">${escapeHtml(getLibraryLabel(state.selectedLibrary))}</span>
                            </div>
                        </div>
                        <div class="organizer-resultList" data-role="organizer-file-list"></div>
                    </section>
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
            </section>
        `}
    `;
    updateDomRefs();
    if (dom.search) {
        dom.search.value = state.query;
    }
    if (dom.sort) {
        dom.sort.value = state.sortKey;
    }
    renderStatus();
}

function renderLibraryHub() {
    if (!dom.libraryGrid) return;
    const libraries = buildLibraryCards(state.items);
    if (!libraries.length) {
        dom.libraryGrid.innerHTML = `
            <article class="organizer-emptyState organizer-emptyState--library">
                <h3>No libraries indexed</h3>
                <p>The current index does not contain any readable library roots.</p>
            </article>
        `;
        return;
    }
    dom.libraryGrid.innerHTML = libraries.map((item) => `
        <button type="button" class="organizer-libraryCard" data-library="${escapeHtml(item.key)}">
            <div class="organizer-libraryCard__head">
                <div class="organizer-libraryCard__copy">
                    <span class="organizer-libraryCard__eyebrow">Library</span>
                    <h3 class="organizer-libraryCard__title">${escapeHtml(item.label)}</h3>
                    <p class="organizer-libraryCard__hint">${escapeHtml(item.hint)}</p>
                </div>
                <span class="organizer-libraryCard__cta">Open</span>
            </div>
            <div class="organizer-libraryCard__stats">
                <span class="organizer-pill">${item.fileCount} files</span>
                <span class="organizer-pill">${item.chunkCount} chunks</span>
                <span class="organizer-pill">${item.issueCount} issues</span>
            </div>
            <p class="organizer-libraryCard__meta">${item.recentAt ? `Updated ${escapeHtml(formatTime(item.recentAt))}` : "No update time recorded"}</p>
            <div class="organizer-libraryCard__tags">
                ${item.categoryLabels.length ? item.categoryLabels.map((label) => `<span class="organizer-libraryTag">${escapeHtml(label)}</span>`).join("") : '<span class="organizer-libraryTag">No category metadata</span>'}
            </div>
        </button>
    `).join("");
}

function renderSummary() {
    if (!dom.summary) return;
    const libraryItems = getCurrentLibraryItems();
    const issues = libraryItems.filter((item) => item.status === "error" || item.status === "oversize").length;
    const chunkCount = libraryItems.reduce((sum, item) => sum + (item.chunkCount || 0), 0);
    const categories = new Set(libraryItems.map((item) => item.category || "other")).size;
    dom.summary.innerHTML = `
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Files</span>
            <strong class="organizer-statCard__value">${libraryItems.length}</strong>
            <span class="organizer-statCard__hint">Current library</span>
        </article>
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Categories</span>
            <strong class="organizer-statCard__value">${categories}</strong>
            <span class="organizer-statCard__hint">Indexed groups</span>
        </article>
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Chunks</span>
            <strong class="organizer-statCard__value">${chunkCount}</strong>
            <span class="organizer-statCard__hint">Readable slices</span>
        </article>
        <article class="organizer-statCard">
            <span class="organizer-statCard__label">Issues</span>
            <strong class="organizer-statCard__value">${issues}</strong>
            <span class="organizer-statCard__hint">Errors and oversize files</span>
        </article>
    `;
}

function renderCategories() {
    if (!dom.categories) return;
    const groups = buildCategoryGroups(getCurrentLibraryItems());
    if (!groups.length) {
        dom.categories.innerHTML = `
            <article class="organizer-emptyState organizer-emptyState--compact">
                <h3>No categories</h3>
                <p>No classified files are available in this library.</p>
            </article>
        `;
        return;
    }
    dom.categories.innerHTML = groups.map((group) => {
        const collapsed = state.collapsedCategories.has(group.key);
        const active = state.selectedCategory === group.key;
        return `
            <section class="organizer-categoryGroup${active ? " is-active" : ""}">
                <div class="organizer-categoryGroup__head">
                    <button type="button" class="organizer-treeToggle organizer-treeToggle--category" data-category-toggle="${escapeHtml(group.key)}" aria-expanded="${collapsed ? "false" : "true"}">
                        <span class="organizer-treeToggle__icon">${collapsed ? "+" : "-"}</span>
                        <span class="organizer-categoryGroup__title">${escapeHtml(group.label)}</span>
                    </button>
                    <button type="button" class="organizer-miniAction${active ? " is-active" : ""}" data-category-filter="${escapeHtml(group.key)}">${active ? "筛选中" : "筛选"}</button>
                </div>
                <p class="organizer-categoryGroup__meta">${group.items.length} files</p>
                ${collapsed ? "" : `
                    <div class="organizer-categoryGroup__files">
                        ${group.items.map((item) => `
                            <button type="button" class="organizer-fileLink${state.selectedPath === item.relativePath ? " is-active" : ""}" data-file-path="${escapeHtml(item.relativePath)}">
                                <span class="organizer-fileLink__name">${escapeHtml(item.name || item.relativePath)}</span>
                                <span class="organizer-fileLink__path">${escapeHtml(item.relativePath)}</span>
                            </button>
                        `).join("")}
                    </div>
                `}
            </section>
        `;
    }).join("");
}

function renderTreeBranch(node, depth = 0) {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const files = [...node.files].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    let html = "";
    dirs.forEach((dir) => {
        const collapsed = state.collapsedDirectories.has(dir.id);
        const active = state.selectedDirectory === dir.id;
        html += `
            <section class="organizer-treeGroup">
                <div class="organizer-treeRow${active ? " is-active" : ""}" style="--tree-depth:${depth}">
                    <button type="button" class="organizer-treeToggle" data-dir-toggle="${escapeHtml(dir.id)}" aria-expanded="${collapsed ? "false" : "true"}">
                        <span class="organizer-treeToggle__icon">${collapsed ? "+" : "-"}</span>
                    </button>
                    <button type="button" class="organizer-treeLabel" data-directory-path="${escapeHtml(dir.id)}">
                        <span class="organizer-treeLabel__name">${escapeHtml(dir.name)}</span>
                        <span class="organizer-treeLabel__meta">${dir.files.length + [...dir.dirs.values()].length} items</span>
                    </button>
                </div>
                ${collapsed ? "" : renderTreeBranch(dir, depth + 1)}
            </section>
        `;
    });
    files.forEach((item) => {
        html += `
            <div class="organizer-treeRow organizer-treeRow--file${state.selectedPath === item.relativePath ? " is-active" : ""}" style="--tree-depth:${depth}">
                <span class="organizer-treeLeaf" aria-hidden="true"></span>
                <button type="button" class="organizer-fileLink organizer-fileLink--tree${state.selectedPath === item.relativePath ? " is-active" : ""}" data-file-path="${escapeHtml(item.relativePath)}">
                    <span class="organizer-fileLink__name">${escapeHtml(item.name || item.relativePath)}</span>
                    <span class="organizer-fileLink__path">${escapeHtml(String(item.ext || "").replace(/^\./, "") || "file")}</span>
                </button>
            </div>
        `;
    });
    return html;
}

function renderDirectoryTree() {
    if (!dom.tree) return;
    const items = getCurrentLibraryItems();
    if (!items.length) {
        dom.tree.innerHTML = `
            <article class="organizer-emptyState organizer-emptyState--compact">
                <h3>No files</h3>
                <p>The selected library does not contain readable files.</p>
            </article>
        `;
        return;
    }
    dom.tree.innerHTML = `<div class="organizer-treeBranch organizer-treeBranch--root">${renderTreeBranch(buildDirectoryTree(items))}</div>`;
}

function renderResultMeta() {
    if (!dom.resultMeta) return;
    const sortLabel = SORT_OPTIONS.find((item) => item.key === state.sortKey)?.label || SORT_OPTIONS[0].label;
    const parts = [
        `${state.visibleItems.length} results`,
        `sorted by ${sortLabel.toLowerCase()}`,
        state.selectedCategory !== "all" ? categoryLabel(state.selectedCategory) : "",
        state.selectedDirectory ? state.selectedDirectory : "",
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
    renderResultMeta();
    renderStatus();
    if (!state.visibleItems.length) {
        dom.list.innerHTML = `
            <article class="organizer-emptyState">
                <h3>No files found</h3>
                <p>Adjust the current search, category, or directory filter.</p>
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

function renderPreviewEmpty(title = "Select a file", desc = "Choose a file from the category, directory, or result list to start reading.") {
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
    if (!window.api?.readAgentLibraryFile || state.currentView !== "detail") {
        return;
    }
    state.selectedPath = filePath;
    state.previewTab = "read";
    state.outlineVisible = false;
    state.previewLoading = true;
    const requestId = state.previewRequestId + 1;
    state.previewRequestId = requestId;
    const fallback = state.visibleItems.find((item) => item.relativePath === filePath)
        || getCurrentLibraryItems().find((item) => item.relativePath === filePath)
        || null;
    state.previewFile = fallback;
    renderFileList();
    renderCategories();
    renderDirectoryTree();
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
            renderCategories();
            renderDirectoryTree();
            renderPreview();
        }
    }
}

async function syncPreviewSelection() {
    if (state.currentView !== "detail") {
        return;
    }
    buildScopedItems();
    if (!state.visibleItems.length) {
        state.selectedPath = "";
        state.previewFile = null;
        renderPreviewEmpty("No matching files", "Adjust the current search, category, or directory filter.");
        return;
    }
    if (!state.visibleItems.some((item) => item.relativePath === state.selectedPath)) {
        state.selectedPath = state.visibleItems[0].relativePath;
    }
    await openFile(state.selectedPath);
}

function applyLocalSearch(items, query) {
    const normalized = query.toLowerCase();
    return items.filter((item) => {
        const haystack = `${item.relativePath}\n${item.name}\n${item.excerpt || ""}`.toLowerCase();
        return haystack.includes(normalized);
    });
}

async function applySearch() {
    if (state.currentView !== "detail") {
        return;
    }
    const query = String(dom.search?.value || "").trim();
    state.query = query;
    if (!query) {
        state.searchMeta = null;
        renderFileList();
        await syncPreviewSelection();
        return;
    }
    if (!window.api?.searchAgentLibrary) {
        state.searchMeta = { items: applyLocalSearch(getCurrentLibraryItems(), query) };
        renderFileList();
        await syncPreviewSelection();
        return;
    }
    try {
        const result = await window.api.searchAgentLibrary(query);
        const items = Array.isArray(result?.items)
            ? result.items.map((item) => {
                const relativePath = item.path || item.relativePath;
                const sourceItem = state.items.find((entry) => entry.relativePath === relativePath && getLibraryKey(entry) === state.selectedLibrary);
                return {
                    ...item,
                    relativePath,
                    name: item.name || String(relativePath || "").split("/").pop() || "",
                    category: item.category || sourceItem?.category || "other",
                    root: sourceItem?.root || state.selectedLibrary,
                    size: item.size || sourceItem?.size || 0,
                    mtimeMs: item.mtimeMs || sourceItem?.mtimeMs || 0,
                };
            }).filter((item) => getLibraryKey(item) === state.selectedLibrary)
            : [];
        state.searchMeta = {
            ...result,
            items,
        };
        renderFileList();
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

function resetDetailFilters() {
    state.selectedCategory = "all";
    state.selectedDirectory = "";
    state.query = "";
    state.searchMeta = null;
}

async function enterLibrary(libraryKey) {
    state.currentView = "detail";
    state.selectedLibrary = libraryKey;
    state.collapsedCategories = new Set();
    state.collapsedDirectories = new Set();
    resetDetailFilters();
    renderShell();
    renderSummary();
    renderCategories();
    renderDirectoryTree();
    renderFileList();
    await syncPreviewSelection();
}

function leaveLibrary() {
    state.currentView = "libraries";
    state.selectedLibrary = "";
    state.selectedCategory = "all";
    state.selectedDirectory = "";
    state.query = "";
    state.searchMeta = null;
    renderShell();
    renderLibraryHub();
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
    if (state.currentView === "libraries") {
        renderShell();
        renderLibraryHub();
        return;
    }
    renderShell();
    renderSummary();
    renderCategories();
    renderDirectoryTree();
    renderFileList();
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
    dom.slot.replaceChildren(root);
    dom.root = root;
    renderShell();
}

function wireEvents() {
    if (!dom.root) return;
    const onSearch = debounce(() => {
        applySearch().catch(console.error);
    });

    dom.root.addEventListener("input", (event) => {
        const target = event.target.closest?.('[data-role="organizer-search"]');
        if (!target) return;
        onSearch();
    });

    dom.root.addEventListener("change", async (event) => {
        const sort = event.target.closest?.('[data-role="organizer-sort"]');
        if (!sort) return;
        state.sortKey = sort.value || "recent";
        renderCategories();
        renderDirectoryTree();
        renderFileList();
        await syncPreviewSelection();
    });

    dom.root.addEventListener("click", async (event) => {
        const libraryButton = event.target.closest("[data-library]");
        if (libraryButton) {
            await enterLibrary(libraryButton.dataset.library || "");
            return;
        }

        const backButton = event.target.closest('[data-action="back-to-libraries"]');
        if (backButton) {
            leaveLibrary();
            return;
        }

        const resetButton = event.target.closest('[data-action="reset-filters"]');
        if (resetButton) {
            resetDetailFilters();
            renderShell();
            renderSummary();
            renderCategories();
            renderDirectoryTree();
            renderFileList();
            await syncPreviewSelection();
            return;
        }

        const clearCategoryButton = event.target.closest('[data-action="clear-category"]');
        if (clearCategoryButton) {
            state.selectedCategory = "all";
            renderShell();
            renderSummary();
            renderCategories();
            renderDirectoryTree();
            renderFileList();
            await syncPreviewSelection();
            return;
        }

        const clearDirectoryButton = event.target.closest('[data-action="clear-directory"]');
        if (clearDirectoryButton) {
            state.selectedDirectory = "";
            renderShell();
            renderSummary();
            renderCategories();
            renderDirectoryTree();
            renderFileList();
            await syncPreviewSelection();
            return;
        }

        const categoryToggle = event.target.closest("[data-category-toggle]");
        if (categoryToggle) {
            const key = categoryToggle.dataset.categoryToggle || "";
            if (state.collapsedCategories.has(key)) {
                state.collapsedCategories.delete(key);
            } else {
                state.collapsedCategories.add(key);
            }
            renderCategories();
            return;
        }

        const categoryFilter = event.target.closest("[data-category-filter]");
        if (categoryFilter) {
            const key = categoryFilter.dataset.categoryFilter || "all";
            state.selectedCategory = state.selectedCategory === key ? "all" : key;
            renderShell();
            renderSummary();
            renderCategories();
            renderDirectoryTree();
            renderFileList();
            await syncPreviewSelection();
            return;
        }

        const dirToggle = event.target.closest("[data-dir-toggle]");
        if (dirToggle) {
            const key = dirToggle.dataset.dirToggle || "";
            if (state.collapsedDirectories.has(key)) {
                state.collapsedDirectories.delete(key);
            } else {
                state.collapsedDirectories.add(key);
            }
            renderDirectoryTree();
            return;
        }

        const dirFilter = event.target.closest("[data-directory-path]");
        if (dirFilter) {
            const key = dirFilter.dataset.directoryPath || "";
            state.selectedDirectory = state.selectedDirectory === key ? "" : key;
            renderShell();
            renderSummary();
            renderCategories();
            renderDirectoryTree();
            renderFileList();
            await syncPreviewSelection();
            return;
        }

        const fileButton = event.target.closest("[data-file-path]");
        if (fileButton) {
            await openFile(fileButton.dataset.filePath || "");
            return;
        }

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
            return;
        }

        const outlineButton = event.target.closest("[data-outline-id]");
        if (outlineButton) {
            const target = dom.previewBody?.querySelector(`#${CSS.escape(outlineButton.dataset.outlineId)}`);
            target?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
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
