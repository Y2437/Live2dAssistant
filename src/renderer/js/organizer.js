import { marked } from "../vendor/marked/lib/marked.esm.js";
import hljs from "../../../node_modules/highlight.js/es/core.js";
import javascript from "../../../node_modules/highlight.js/es/languages/javascript.js";
import typescript from "../../../node_modules/highlight.js/es/languages/typescript.js";
import json from "../../../node_modules/highlight.js/es/languages/json.js";
import xml from "../../../node_modules/highlight.js/es/languages/xml.js";
import css from "../../../node_modules/highlight.js/es/languages/css.js";
import markdownLang from "../../../node_modules/highlight.js/es/languages/markdown.js";
import bash from "../../../node_modules/highlight.js/es/languages/bash.js";
import python from "../../../node_modules/highlight.js/es/languages/python.js";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("markdown", markdownLang);
hljs.registerLanguage("md", markdownLang);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);

const $ = (selector, root = document) => root.querySelector(selector);

const organizerState = {
    items: [],
    filteredItems: [],
    selectedPath: "",
    expandedDirs: new Set(["src"]),
};

const dom = {
    slot: $('[data-slot="organizer"]'),
    root: null,
    search: null,
    tree: null,
    list: null,
    meta: null,
    previewTitle: null,
    previewMeta: null,
    previewBody: null,
    outline: null,
    empty: null,
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
                        <div class="organizer-previewEmpty" data-role="organizer-preview-empty">No file selected.</div>
                    </article>
                </div>
            </section>
        </div>
    `;

    dom.slot.replaceChildren(root);
    dom.root = root;
    dom.search = $('[data-role="organizer-search"]', root);
    dom.tree = $('[data-role="organizer-tree"]', root);
    dom.list = $('[data-role="organizer-file-list"]', root);
    dom.meta = $('[data-role="organizer-meta"]', root);
    dom.previewTitle = $('[data-role="organizer-preview-title"]', root);
    dom.previewMeta = $('[data-role="organizer-preview-meta"]', root);
    dom.previewBody = $('[data-role="organizer-preview-body"]', root);
    dom.outline = $('[data-role="organizer-outline"]', root);
    dom.empty = $('[data-role="organizer-preview-empty"]', root);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
}

function formatSize(value) {
    const size = Number(value) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getLanguageFromExt(ext) {
    const value = String(ext || "").replace(/^\./, "").toLowerCase();
    const map = {
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        json: "json",
        html: "html",
        htm: "html",
        xml: "xml",
        css: "css",
        md: "markdown",
        markdown: "markdown",
        py: "python",
        sh: "bash",
        ps1: "bash",
        yml: "yaml",
        yaml: "yaml",
    };
    return map[value] || value || "plaintext";
}

function buildTree(items) {
    const root = {};
    for (const item of items) {
        const parts = item.relativePath.split("/");
        let cursor = root;
        for (let index = 0; index < parts.length - 1; index += 1) {
            const part = parts[index];
            cursor[part] = cursor[part] || {__children: {}};
            cursor = cursor[part].__children;
        }
    }
    return root;
}

function renderTreeNode(node, parentPath = "") {
    const entries = Object.keys(node).sort((a, b) => a.localeCompare(b));
    if (!entries.length) {
        return '<div class="organizer-tree__empty">No folders</div>';
    }
    return entries.map((name) => {
        const fullPath = parentPath ? `${parentPath}/${name}` : name;
        const expanded = organizerState.expandedDirs.has(fullPath);
        const childHtml = expanded ? renderTreeNode(node[name].__children, fullPath) : "";
        return `
            <div class="organizer-treeNode">
                <button type="button" class="organizer-treeNode__toggle" data-path="${escapeHtml(fullPath)}">
                    <span>${expanded ? "−" : "+"}</span>
                    <span>${escapeHtml(name)}</span>
                </button>
                <div class="organizer-treeNode__children">${childHtml}</div>
            </div>
        `;
    }).join("");
}

function renderTree() {
    if (!dom.tree) return;
    dom.tree.innerHTML = renderTreeNode(buildTree(organizerState.filteredItems));
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
            <div class="organizer-fileItem__excerpt">${escapeHtml(item.excerpt || "")}</div>
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

function buildMarkdownOutline(markdown) {
    return String(markdown || "")
        .split("\n")
        .map((line) => {
            const match = line.match(/^(#{1,6})\s+(.+)$/);
            if (!match) return null;
            return {
                level: match[1].length,
                text: match[2].trim(),
                id: `outline-${match[2].trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, "-")}`,
            };
        })
        .filter(Boolean);
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
    const src = `file:///${file.fullPath.replace(/\\/g, "/")}`;
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
    dom.previewMeta.textContent = `${file.ext} · ${file.mode}${file.fullPath ? ` · ${file.fullPath}` : ""}`;
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

function applyFilter() {
    const query = String(dom.search?.value || "").trim().toLowerCase();
    organizerState.filteredItems = organizerState.items.filter((item) => {
        if (!query) return true;
        const haystack = `${item.relativePath}\n${item.name}\n${item.excerpt || ""}`.toLowerCase();
        return haystack.includes(query);
    });
    renderTree();
    renderFileList();
}

async function loadIndex() {
    if (!window.api?.getAgentLibraryIndex) {
        return;
    }
    createLayout();
    const data = await window.api.getAgentLibraryIndex();
    organizerState.items = Array.isArray(data?.items) ? data.items : [];
    organizerState.filteredItems = organizerState.items.slice();
    dom.meta.textContent = `${organizerState.items.length} files indexed · updated ${formatTime(data?.updatedAt)}`;
    renderTree();
    renderFileList();
    if (!organizerState.selectedPath && organizerState.filteredItems.length) {
        await openFile(organizerState.filteredItems[0].relativePath);
    }
}

function wireEvents() {
    if (!dom.root) return;
    dom.search?.addEventListener("input", () => {
        applyFilter();
    });
    dom.tree?.addEventListener("click", (event) => {
        const button = event.target.closest(".organizer-treeNode__toggle");
        if (!button) return;
        const path = button.dataset.path;
        if (organizerState.expandedDirs.has(path)) {
            organizerState.expandedDirs.delete(path);
        } else {
            organizerState.expandedDirs.add(path);
        }
        renderTree();
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
