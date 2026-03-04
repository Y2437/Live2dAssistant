import { marked } from "../../vendor/marked/lib/marked.esm.js";
import hljs from "../../vendor/highlight-lite.mjs";
import { $, escapeHtml } from "../shared/dom.js";
import {
    buildMarkdownOutline,
    buildTree,
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

const organizerState = {
    items: [],
    filteredItems: [],
    selectedPath: "",
    expandedDirs: new Set(["src"]),
    updatedAt: "",
    query: "",
    selectedCategory: "all",
    selectedFolder: "",
    categories: [],
    stats: null,
};

const dom = {
    slot: $('[data-slot="organizer"]'),
    root: null,
    search: null,
    categories: null,
    tree: null,
    list: null,
    meta: null,
    previewTitle: null,
    previewMeta: null,
    previewBody: null,
    outline: null,
};

function createLayout() {
    if (!dom.slot || dom.root) {
        return;
    }
    const root = document.createElement("section");
    root.className = "organizer-shell";
    root.innerHTML = `
        <div class="organizer-toolbar">
            <label class="organizer-search">
                <span class="organizer-search__label">Search</span>
                <input class="organizer-search__input" data-role="organizer-search" type="search" placeholder="Search file name or indexed content" autocomplete="off" spellcheck="false" />
            </label>
            <div class="organizer-meta" data-role="organizer-meta">Loading library index...</div>
        </div>
        <div class="organizer-layout">
            <aside class="organizer-panel organizer-panel--category">
                <div class="organizer-panel__head">Categories</div>
                <div class="organizer-categoryList" data-role="organizer-categories"></div>
            </aside>
            <aside class="organizer-panel organizer-panel--tree">
                <div class="organizer-panel__head">Folders</div>
                <div class="organizer-tree" data-role="organizer-tree"></div>
            </aside>
            <section class="organizer-panel organizer-panel--files">
                <div class="organizer-panel__head">Files</div>
                <div class="organizer-fileList" data-role="organizer-file-list"></div>
            </section>
            <section class="organizer-panel organizer-panel--preview">
                <div class="organizer-previewHead">
                    <div>
                        <h3 class="organizer-previewHead__title" data-role="organizer-preview-title">Select a file</h3>
                        <p class="organizer-previewHead__meta" data-role="organizer-preview-meta"></p>
                    </div>
                </div>
                <div class="organizer-previewLayout">
                    <aside class="organizer-outline" data-role="organizer-outline">
                        <div class="organizer-outline__empty">Outline</div>
                    </aside>
                    <article class="organizer-previewBody" data-role="organizer-preview-body">
                        <div class="organizer-previewEmpty">No file selected.</div>
                    </article>
                </div>
            </section>
        </div>
    `;

    dom.slot.replaceChildren(root);
    dom.root = root;
    dom.search = $('[data-role="organizer-search"]', root);
    dom.categories = $('[data-role="organizer-categories"]', root);
    dom.tree = $('[data-role="organizer-tree"]', root);
    dom.list = $('[data-role="organizer-file-list"]', root);
    dom.meta = $('[data-role="organizer-meta"]', root);
    dom.previewTitle = $('[data-role="organizer-preview-title"]', root);
    dom.previewMeta = $('[data-role="organizer-preview-meta"]', root);
    dom.previewBody = $('[data-role="organizer-preview-body"]', root);
    dom.outline = $('[data-role="organizer-outline"]', root);
}

function renderTreeNode(node, parentPath = "") {
    const names = Object.keys(node).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
        return '<div class="organizer-tree__empty">No folders</div>';
    }
    return names.map((name) => {
        const fullPath = parentPath ? `${parentPath}/${name}` : name;
        const expanded = organizerState.expandedDirs.has(fullPath);
        const active = organizerState.selectedFolder === fullPath;
        return `
            <div class="organizer-treeNode">
                <button type="button" class="organizer-treeNode__toggle${active ? " is-active" : ""}" data-path="${escapeHtml(fullPath)}">
                    <span>${expanded ? "-" : "+"}</span>
                    <span>${escapeHtml(name)}</span>
                </button>
                <div class="organizer-treeNode__children">${expanded ? renderTreeNode(node[name].children, fullPath) : ""}</div>
            </div>
        `;
    }).join("");
}

function renderCategories() {
    if (!dom.categories) return;
    const items = [{key: "all", count: organizerState.items.length}, ...organizerState.categories.filter((item) => item.key !== "all")];
    dom.categories.innerHTML = items.map((item) => `
        <button type="button" class="organizer-categoryItem${organizerState.selectedCategory === item.key ? " is-active" : ""}" data-category="${escapeHtml(item.key)}">
            <span>${escapeHtml(categoryLabel(item.key))}</span>
            <span>${escapeHtml(String(item.count || 0))}</span>
        </button>
    `).join("");
}

function renderTree() {
    if (!dom.tree) return;
    dom.tree.innerHTML = `
        <button type="button" class="organizer-treeNode__toggle${organizerState.selectedFolder ? "" : " is-active"}" data-path="">
            <span>-</span>
            <span>All folders</span>
        </button>
        ${renderTreeNode(buildTree(organizerState.filteredItems))}
    `;
}

function renderFileList() {
    if (!dom.list) return;
    if (!organizerState.filteredItems.length) {
        dom.list.innerHTML = '<div class="organizer-fileList__empty">No files matched.</div>';
        return;
    }
    dom.list.innerHTML = organizerState.filteredItems.map((item) => `
        <button type="button" class="organizer-fileItem${item.relativePath === organizerState.selectedPath ? " is-active" : ""}" data-file-path="${escapeHtml(item.relativePath)}">
            <div class="organizer-fileItem__head">
                <span class="organizer-fileItem__name">${escapeHtml(item.name)}</span>
                <span class="organizer-fileItem__ext">${escapeHtml(item.ext || "")}</span>
            </div>
            <div class="organizer-fileItem__path">${escapeHtml(item.relativePath)}</div>
            <div class="organizer-fileItem__path">${escapeHtml(categoryLabel(item.category || "other"))}${item.chunkCount ? ` · ${escapeHtml(String(item.chunkCount))} chunks` : ""}</div>
            <div class="organizer-fileItem__excerpt">${escapeHtml(item.excerpt || "")}</div>
            ${Array.isArray(item.matches) && item.matches.length ? `<div class="organizer-fileItem__excerpt">${escapeHtml(item.matches[0].preview || "")}</div>` : ""}
        </button>
    `).join("");
}

function renderOutline(items) {
    if (!dom.outline) return;
    if (!items.length) {
        dom.outline.innerHTML = '<div class="organizer-outline__empty">No outline</div>';
        return;
    }
    dom.outline.innerHTML = items.map((item) => `
        <button type="button" class="organizer-outline__item" data-outline-id="${escapeHtml(item.id)}" style="--outline-level:${item.level}">
            ${escapeHtml(item.text)}
        </button>
    `).join("");
}

function renderMarkdownPreview(file) {
    const outlineItems = buildMarkdownOutline(file.content);
    renderOutline(outlineItems);
    const html = marked.parse(file.content || "");
    dom.previewBody.innerHTML = `<div class="organizer-markdown">${html}</div>`;
    const headings = dom.previewBody.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headings.forEach((heading, index) => {
        if (outlineItems[index]) {
            heading.id = outlineItems[index].id;
        }
    });
}

function renderCodePreview(file) {
    renderOutline([]);
    const language = getLanguageFromExt(file.ext);
    const source = String(file.content || "");
    let html;
    try {
        html = hljs.highlight(source, {language}).value;
    } catch (error) {
        html = hljs.highlightAuto(source).value;
    }
    dom.previewBody.innerHTML = `
        <pre class="organizer-code"><code class="hljs ${escapeHtml(language)}">${html}</code></pre>
    `;
}

function renderPdfPreview(file) {
    renderOutline([]);
    const src = `file:///${String(file.fullPath || "").replace(/\\/g, "/")}`;
    dom.previewBody.innerHTML = `
        <iframe class="organizer-pdf" src="${encodeURI(src)}" title="${escapeHtml(file.path)}"></iframe>
    `;
}

function renderBinaryPreview(file) {
    renderOutline([]);
    dom.previewBody.innerHTML = `
        <div class="organizer-previewEmpty">
            Preview unavailable for ${escapeHtml(file.ext || "binary")} files.
        </div>
    `;
}

async function openFile(filePath) {
    if (!window.api?.readAgentLibraryFile) {
        return;
    }
    organizerState.selectedPath = filePath;
    renderFileList();
    const file = await window.api.readAgentLibraryFile(filePath);
    dom.previewTitle.textContent = file.path;
    const metaParts = [
        file.ext,
        file.category ? categoryLabel(file.category) : "",
        file.mode,
        Number.isFinite(Number(file.size)) ? formatSize(file.size) : "",
        file.status || "",
        file.chunkCount ? `${file.chunkCount} chunks` : "",
        file.fullPath || "",
    ].filter(Boolean);
    dom.previewMeta.textContent = metaParts.join(" · ");
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
    renderCodePreview(file);
}

function filterItems(items) {
    return items.filter((item) => {
        const category = item.category || "other";
        if (organizerState.selectedCategory !== "all" && category !== organizerState.selectedCategory) {
            return false;
        }
        if (organizerState.selectedFolder) {
            const currentPath = String(item.relativePath || "");
            if (currentPath !== organizerState.selectedFolder && !currentPath.startsWith(`${organizerState.selectedFolder}/`)) {
                return false;
            }
        }
        return true;
    });
}

function updateMetaLabel(mode = "browse", queryTokenCount = 0) {
    if (!dom.meta) return;
    const stats = organizerState.stats;
    const indexSummary = stats
        ? `index +${stats.added || 0} ~${stats.updated || 0} =${stats.unchanged || 0} -${stats.removed || 0}`
        : "";
    const scope = [
        organizerState.selectedCategory !== "all" ? categoryLabel(organizerState.selectedCategory) : "",
        organizerState.selectedFolder || "",
    ].filter(Boolean).join(" · ");
    const parts = [
        `${organizerState.filteredItems.length} files`,
        mode === "search" ? `${queryTokenCount} query tokens` : "",
        organizerState.updatedAt ? `updated ${formatTime(organizerState.updatedAt)}` : "",
        indexSummary,
        scope,
    ].filter(Boolean);
    dom.meta.textContent = parts.join(" · ");
}

function commitFilteredItems(items, options = {}) {
    organizerState.filteredItems = filterItems(items);
    if (!organizerState.filteredItems.some((item) => item.relativePath === organizerState.selectedPath)) {
        organizerState.selectedPath = organizerState.filteredItems[0]?.relativePath || "";
    }
    renderCategories();
    renderTree();
    renderFileList();
    updateMetaLabel(options.mode || "browse", options.queryTokenCount || 0);
}

async function syncPreviewSelection() {
    if (!organizerState.selectedPath) {
        if (dom.previewTitle) {
            dom.previewTitle.textContent = "Select a file";
        }
        if (dom.previewMeta) {
            dom.previewMeta.textContent = "";
        }
        if (dom.previewBody) {
            dom.previewBody.innerHTML = '<div class="organizer-previewEmpty">No file selected.</div>';
        }
        if (dom.outline) {
            dom.outline.innerHTML = '<div class="organizer-outline__empty">No outline</div>';
        }
        return;
    }
    await openFile(organizerState.selectedPath);
}

function applyFilter() {
    const query = String(dom.search?.value || "").trim();
    organizerState.query = query;
    if (!query) {
        commitFilteredItems(organizerState.items, {mode: "browse"});
        syncPreviewSelection().catch(console.error);
        return;
    }
    if (!window.api?.searchAgentLibrary) {
        const localItems = organizerState.items.filter((item) => {
            const haystack = `${item.relativePath}\n${item.name}\n${item.excerpt || ""}`.toLowerCase();
            return haystack.includes(query.toLowerCase());
        });
        commitFilteredItems(localItems, {mode: "search"});
        syncPreviewSelection().catch(console.error);
        return;
    }
    window.api.searchAgentLibrary(query).then((result) => {
        const items = Array.isArray(result?.items)
            ? result.items.map((item) => ({
                ...item,
                relativePath: item.path || item.relativePath,
                name: item.name || String(item.path || "").split("/").pop() || "",
                category: item.category || "other",
            }))
            : [];
        commitFilteredItems(items, {
            mode: "search",
            queryTokenCount: result?.queryTokens?.length || 0,
        });
        syncPreviewSelection().catch(console.error);
    }).catch((error) => {
        console.error(error);
        dom.meta.textContent = `Search failed: ${error.message || error}`;
    });
}

async function loadIndex() {
    if (!window.api?.getAgentLibraryIndex) {
        return;
    }
    createLayout();
    const data = await window.api.getAgentLibraryIndex();
    organizerState.items = Array.isArray(data?.items) ? data.items : [];
    organizerState.updatedAt = data?.updatedAt || "";
    organizerState.categories = Array.isArray(data?.categories) ? data.categories : [];
    organizerState.stats = data?.stats || null;
    commitFilteredItems(organizerState.items, {mode: "browse"});
    await syncPreviewSelection();
}

function wireEvents() {
    if (!dom.root) return;
    dom.search?.addEventListener("input", () => {
        applyFilter();
    });
    dom.categories?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-category]");
        if (!button) return;
        organizerState.selectedCategory = button.dataset.category || "all";
        applyFilter();
    });
    dom.tree?.addEventListener("click", (event) => {
        const button = event.target.closest(".organizer-treeNode__toggle");
        if (!button) return;
        const folderPath = button.dataset.path || "";
        organizerState.selectedFolder = folderPath;
        if (folderPath) {
            if (organizerState.expandedDirs.has(folderPath)) {
                organizerState.expandedDirs.delete(folderPath);
            } else {
                organizerState.expandedDirs.add(folderPath);
            }
        }
        applyFilter();
    });
    dom.list?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-file-path]");
        if (!button) return;
        await openFile(button.dataset.filePath);
    });
    dom.outline?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-outline-id]");
        if (!button) return;
        const target = dom.previewBody?.querySelector(`#${CSS.escape(button.dataset.outlineId)}`);
        target?.scrollIntoView({behavior: "smooth", block: "start"});
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
