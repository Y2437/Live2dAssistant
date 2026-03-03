const PAGE_SIZE = 6;

const COPY = {
    cardsTotal: "\u5361\u7247\u603b\u6570",
    categoryTotal: "\u5206\u7c7b\u6570",
    title: "\u77e5\u8bc6\u5361\u7247\u7bb1",
    desc: "\u9ed8\u8ba4\u663e\u793a\u5361\u7247\u5217\u8868\u3002\u5355\u51fb\u9009\u4e2d\uff0c\u53cc\u51fb\u6253\u5f00\uff1b\u65b0\u5efa\u548c\u7f16\u8f91\u5728\u72ec\u7acb\u5de5\u4f5c\u533a\u5185\u5b8c\u6210\u3002",
    searchLabel: "\u641c\u7d22",
    searchPlaceholder: "\u6309\u6807\u9898\u3001\u5206\u7c7b\u6216\u6b63\u6587\u5185\u5bb9\u641c\u7d22",
    create: "\u65b0\u5efa",
    edit: "\u7f16\u8f91",
    remove: "\u5220\u9664",
    category: "\u5206\u7c7b",
    allCategories: "\u5168\u90e8\u5206\u7c7b",
    backToList: "\u8fd4\u56de\u5361\u7247\u5217\u8868",
    createMode: "\u65b0\u5efa\u5361\u7247",
    editMode: "\u7f16\u8f91\u5361\u7247",
    createTitle: "\u6574\u7406\u4e00\u5f20\u65b0\u7684\u77e5\u8bc6\u5361\u7247",
    editTitle: "\u8c03\u6574\u8fd9\u5f20\u77e5\u8bc6\u5361\u7247",
    editorDesc: "\u6807\u9898\u3001\u5206\u7c7b\u4e0e\u6458\u8981\u96c6\u4e2d\u5728\u4e0a\u65b9\uff0c\u6b63\u6587\u652f\u6301 Markdown\uff0c\u53f3\u4fa7\u53ef\u5b9e\u65f6\u68c0\u67e5\u6392\u7248\u6548\u679c\u3002",
    save: "\u4fdd\u5b58\u5361\u7247",
    cancel: "\u53d6\u6d88",
    titleField: "\u6807\u9898",
    categoryField: "\u5206\u7c7b",
    editorField: "\u7f16\u8f91\u533a",
    previewField: "\u9884\u89c8\u533a",
    summaryField: "\u5361\u7247\u6458\u8981",
    summaryPlaceholder: "\u5728\u8fd9\u91cc\u67e5\u770b\u6216\u624b\u52a8\u8c03\u6574\u5361\u7247\u6458\u8981",
    summaryGenerate: "\u667a\u80fd\u751f\u6210\u6458\u8981",
    summaryGenerating: "\u6b63\u5728\u751f\u6210\u6458\u8981...",
    titlePlaceholder: "\u4f8b\u5982\uff1a\u4e09\u6708\u9879\u76ee\u5207\u6362\u7b56\u7565",
    categoryPlaceholder: "\u4f8b\u5982\uff1a\u9879\u76ee\u3001\u7075\u611f\u3001\u8bbe\u5b9a",
    contentPlaceholder: "\u8f93\u5165 Markdown \u5185\u5bb9",
    localStatus: "\u5185\u5bb9\u4f1a\u76f4\u63a5\u5199\u5165\u672c\u5730 JSON\u3002",
    editingCreate: "\u7f16\u8f91\u4e2d\uff0c\u53ef\u968f\u65f6\u4fdd\u5b58\u5361\u7247\u3002",
    editingUpdate: "\u7f16\u8f91\u4e2d\uff0c\u53ef\u968f\u65f6\u4fdd\u5b58\u66f4\u65b0\u3002",
    savingCreate: "\u6b63\u5728\u4fdd\u5b58\u5361\u7247...",
    savingUpdate: "\u6b63\u5728\u66f4\u65b0\u5361\u7247...",
    savedCreate: "\u5df2\u4fdd\u5b58\uff1a",
    savedUpdate: "\u5df2\u66f4\u65b0\uff1a",
    untitled: "\u672a\u547d\u540d\u5361\u7247",
    uncategorized: "\u672a\u5206\u7c7b",
    previewEmpty: "\u5c1a\u672a\u586b\u5199\u5185\u5bb9\u3002",
    noTime: "\u672a\u8bb0\u5f55\u65f6\u95f4",
    pagePrev: "\u4e0a\u4e00\u9875",
    pageNext: "\u4e0b\u4e00\u9875",
    pageMeta: (page, totalPages, totalItems) => `\u7b2c ${page} / ${totalPages} \u9875\uff0c\u5171 ${totalItems} \u6761`,
    categoriesInline: (count) => `${count} \u7c7b`,
    creatorPrefix: "\u521b\u5efa\u8005",
    createdPrefix: "\u521b\u5efa\u65f6\u95f4",
    editHint: (title) => `\u6b63\u5728\u7f16\u8f91\uff1a${title}`,
    emptyTitle: "\u6ca1\u6709\u5339\u914d\u7684\u77e5\u8bc6\u5361\u7247",
    emptyDesc: "\u53ef\u4ee5\u8c03\u6574\u641c\u7d22\u6216\u5207\u6362\u5206\u7c7b\uff0c\u4e5f\u53ef\u4ee5\u76f4\u63a5\u65b0\u5efa\u5361\u7247\u3002",
    modalLabel: "\u77e5\u8bc6\u5361\u7247\u8be6\u60c5",
    confirmCreateAbandon: "\u5f53\u524d\u6709\u672a\u4fdd\u5b58\u5185\u5bb9\uff0c\u786e\u5b9a\u653e\u5f03\u5e76\u65b0\u5efa\u5361\u7247\u5417\uff1f",
    confirmEditAbandon: "\u5f53\u524d\u6709\u672a\u4fdd\u5b58\u5185\u5bb9\uff0c\u786e\u5b9a\u653e\u5f03\u5e76\u5207\u6362\u5230\u5176\u4ed6\u5361\u7247\u5417\uff1f",
    confirmBackAbandon: "\u5f53\u524d\u6709\u672a\u4fdd\u5b58\u5185\u5bb9\uff0c\u786e\u5b9a\u8fd4\u56de\u5217\u8868\u5417\uff1f",
    confirmDelete: (title) => `\u786e\u5b9a\u5220\u9664\u5361\u7247\u201c${title}\u201d\u5417\uff1f`,
};

const cardsState = {
    items: [],
    query: "",
    activeCategory: "all",
    selectedCardId: "",
    pageMode: "list",
    editorMode: "create",
    currentPage: 1,
    editorSnapshot: "",
    loaded: false,
};

const cardsDom = {
    root: document.querySelector(".cards-root"),
    hero: document.querySelector(".cards-hero"),
    count: document.querySelector('[data-role="cards-count"]'),
    categoryCount: document.querySelector('[data-role="cards-category-count"]'),
    categoryCountInline: document.querySelector('[data-role="cards-category-count-inline"]'),
    search: document.querySelector('[data-role="cards-search"]'),
    filters: document.querySelector('[data-role="cards-filters"]'),
    grid: document.querySelector('[data-role="cards-grid"]'),
    pagePrev: document.querySelector('[data-role="cards-page-prev"]'),
    pageNext: document.querySelector('[data-role="cards-page-next"]'),
    pageMeta: document.querySelector('[data-role="cards-page-meta"]'),
    pageList: document.querySelector('[data-role="cards-page-list"]'),
    listPage: document.querySelector('[data-role="cards-list-page"]'),
    editorPage: document.querySelector('[data-role="cards-editor-page"]'),
    createBtn: document.querySelector('[data-role="cards-create"]'),
    editSelectedBtn: document.querySelector('[data-role="cards-edit-selected"]'),
    deleteSelectedBtn: document.querySelector('[data-role="cards-delete-selected"]'),
    editorModeLabel: document.querySelector('[data-role="cards-editor-mode-label"]'),
    editorTitle: document.querySelector('[data-role="cards-editor-title"]'),
    editorDesc: document.querySelector(".cards-editorHead__desc"),
    form: null,
    formStatus: null,
    titleInput: null,
    categoryInput: null,
    categorySuggest: null,
    contentInput: null,
    summaryInput: null,
    summaryTrigger: null,
    preview: null,
    cancelEditorBtns: [],
    modal: document.querySelector('[data-role="cards-modal"]'),
    modalTitle: document.querySelector('[data-role="cards-modal-title"]'),
    modalCategory: document.querySelector('[data-role="cards-modal-category"]'),
    modalTime: document.querySelector('[data-role="cards-modal-time"]'),
    modalContent: document.querySelector('[data-role="cards-modal-content"]'),
};

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function stripMarkdown(value) {
    return String(value || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/^(#{1,6}\s+)/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/^[-*]\s+/gm, "")
        .replace(/^\d+\.\s+/gm, "")
        .replace(/[*_~]/g, "")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function renderInlineMarkdown(value) {
    return escapeHtml(value)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
        .replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
}

function renderMarkdown(value) {
    const source = String(value || "").replace(/\r\n/g, "\n");
    if (!source.trim()) {
        return `<div class="cards-markdown__empty">${COPY.previewEmpty}</div>`;
    }

    const codeBlocks = [];
    const placeholderSource = source.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, language, code) => {
        const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
        codeBlocks.push({language: language || "", code});
        return token;
    });

    const html = [];
    const lines = placeholderSource.split("\n");
    let paragraph = [];
    let listType = "";
    let listItems = [];
    let quoteLines = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${renderInlineMarkdown(paragraph.join("<br>"))}</p>`);
        paragraph = [];
    };

    const flushList = () => {
        if (!listItems.length) return;
        html.push(`<${listType}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
        listItems = [];
        listType = "";
    };

    const flushQuote = () => {
        if (!quoteLines.length) return;
        html.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
        quoteLines = [];
    };

    lines.forEach((rawLine) => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            flushParagraph();
            flushList();
            flushQuote();
            return;
        }

        if (/^@@CODEBLOCK_\d+@@$/.test(trimmed)) {
            flushParagraph();
            flushList();
            flushQuote();
            const block = codeBlocks[Number(trimmed.match(/\d+/)?.[0] || 0)];
            const language = block?.language ? `<span class="cards-markdown__lang">${escapeHtml(block.language)}</span>` : "";
            html.push(`<pre class="cards-markdown__pre">${language}<code>${escapeHtml(block?.code || "").trimEnd()}</code></pre>`);
            return;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            flushList();
            flushQuote();
            const level = Math.min(6, heading[1].length);
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            return;
        }

        const quote = trimmed.match(/^>\s?(.*)$/);
        if (quote) {
            flushParagraph();
            flushList();
            quoteLines.push(quote[1] || "");
            return;
        }

        const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
        if (ordered) {
            flushParagraph();
            flushQuote();
            if (listType && listType !== "ol") {
                flushList();
            }
            listType = "ol";
            listItems.push(ordered[1]);
            return;
        }

        const unordered = trimmed.match(/^[-*]\s+(.+)$/);
        if (unordered) {
            flushParagraph();
            flushQuote();
            if (listType && listType !== "ul") {
                flushList();
            }
            listType = "ul";
            listItems.push(unordered[1]);
            return;
        }

        flushList();
        flushQuote();
        paragraph.push(trimmed);
    });

    flushParagraph();
    flushList();
    flushQuote();

    return html.join("");
}

function formatDate(value) {
    if (!value) {
        return COPY.noTime;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function getCategories() {
    return Array.from(new Set(cardsState.items.map((item) => item.category).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function getCardById(cardId) {
    return cardsState.items.find((item) => item.id === cardId) || null;
}

function getVisibleCards() {
    const query = cardsState.query.trim().toLowerCase();
    return cardsState.items.filter((item) => {
        const matchesCategory = cardsState.activeCategory === "all" || item.category === cardsState.activeCategory;
        if (!matchesCategory) {
            return false;
        }
        if (!query) {
            return true;
        }
        const haystack = `${item.title}\n${item.category}\n${item.content}`.toLowerCase();
        return haystack.includes(query);
    });
}

function getPagedCards() {
    const items = getVisibleCards();
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    cardsState.currentPage = Math.min(cardsState.currentPage, totalPages);
    const startIndex = (cardsState.currentPage - 1) * PAGE_SIZE;
    return {
        items: items.slice(startIndex, startIndex + PAGE_SIZE),
        totalItems: items.length,
        totalPages,
    };
}

function serializeEditorForm() {
    if (!cardsDom.form) {
        return "";
    }
    return JSON.stringify({
        id: cardsDom.form.elements.namedItem("id")?.value || "",
        title: cardsDom.titleInput?.value || "",
        category: cardsDom.categoryInput?.value || "",
        content: cardsDom.contentInput?.value || "",
        summary: cardsDom.summaryInput?.value || "",
    });
}

function hasEditorChanges() {
    return cardsState.pageMode === "editor" && serializeEditorForm() !== cardsState.editorSnapshot;
}

function refreshEditorDom() {
    cardsDom.form = document.querySelector('[data-role="cards-form"]');
    cardsDom.formStatus = document.querySelector('[data-role="cards-form-status"]');
    cardsDom.titleInput = document.querySelector('[data-role="cards-title-input"]');
    cardsDom.categoryInput = document.querySelector('[data-role="cards-category-input"]');
    cardsDom.categorySuggest = document.querySelector('[data-role="cards-category-suggest"]');
    cardsDom.contentInput = document.querySelector('[data-role="cards-content-input"]');
    cardsDom.summaryInput = document.querySelector('[data-role="cards-summary-input"]');
    cardsDom.summaryTrigger = document.querySelector('[data-role="cards-summary-generate"]');
    cardsDom.preview = document.querySelector('[data-role="cards-preview"]');
    cardsDom.cancelEditorBtns = Array.from(document.querySelectorAll('[data-role="cards-cancel-editor"], [data-role="cards-cancel-editor-inline"]'));
}

function rebuildEditorForm() {
    const editorPanel = document.querySelector(".cards-panel--editor");
    if (!editorPanel) {
        return;
    }

    const oldForm = editorPanel.querySelector('[data-role="cards-form"]');
    if (!oldForm) {
        return;
    }

    oldForm.outerHTML = `
        <form class="cards-form" data-role="cards-form">
            <input type="hidden" name="id" />
            <div class="cards-editorDock">
                <div class="cards-editorTopbar">
                    <div class="cards-editorMetaCluster">
                        <label class="cards-field">
                            <span class="cards-field__label">${COPY.titleField}</span>
                            <input
                                class="cards-field__control"
                                data-role="cards-title-input"
                                name="title"
                                type="text"
                                maxlength="80"
                                placeholder="${COPY.titlePlaceholder}"
                                required
                            />
                        </label>
                        <label class="cards-field">
                            <span class="cards-field__label">${COPY.categoryField}</span>
                            <div class="cards-categoryPicker" data-role="cards-category-picker">
                                <input
                                    class="cards-field__control"
                                    data-role="cards-category-input"
                                    name="category"
                                    type="text"
                                    maxlength="40"
                                    placeholder="${COPY.categoryPlaceholder}"
                                    autocomplete="off"
                                />
                                <div class="cards-suggest" data-role="cards-category-suggest" hidden></div>
                            </div>
                        </label>
                        <div class="cards-summaryBar">
                            <div class="cards-summaryBar__head">
                                <span class="cards-field__label">${COPY.summaryField}</span>
                            </div>
                            <textarea
                                class="cards-field__control cards-field__control--summary"
                                data-role="cards-summary-input"
                                name="summary"
                                rows="3"
                                maxlength="120"
                                placeholder="${COPY.summaryPlaceholder}"
                                readonly
                            ></textarea>
                        </div>
                    </div>
                    <div class="cards-editorDock__actions">
                        <button type="button" class="cards-toolbarBtn" data-role="cards-summary-generate">${COPY.summaryGenerate}</button>
                        <button type="button" class="cards-toolbarBtn" data-role="cards-cancel-editor-inline">${COPY.cancel}</button>
                        <button type="submit" class="cards-submit">${COPY.save}</button>
                    </div>
                </div>
            </div>
            <p class="cards-form__status" data-role="cards-form-status">${COPY.localStatus}</p>
            <div class="cards-editorSplit">
                <label class="cards-field cards-field--editor">
                    <span class="cards-field__label">${COPY.editorField}</span>
                    <textarea
                        class="cards-field__control cards-field__control--textarea"
                        data-role="cards-content-input"
                        name="content"
                        rows="14"
                        placeholder="${COPY.contentPlaceholder}"
                        required
                    ></textarea>
                </label>
                <section class="cards-preview">
                    <div class="cards-preview__head">
                        <span class="cards-field__label">${COPY.previewField}</span>
                    </div>
                    <div class="cards-preview__body" data-role="cards-preview"></div>
                </section>
            </div>
        </form>
    `;
}

function normalizeCardsCopy() {
    const setText = (selector, text) => {
        const node = document.querySelector(selector);
        if (node) {
            node.textContent = text;
        }
    };

    const statLabels = document.querySelectorAll(".cards-stat__label");
    if (statLabels[0]) statLabels[0].textContent = COPY.cardsTotal;
    if (statLabels[1]) statLabels[1].textContent = COPY.categoryTotal;

    setText(".cards-title", COPY.title);
    setText(".cards-desc", COPY.desc);
    setText(".cards-search__label", COPY.searchLabel);
    setText('[data-role="cards-create"]', COPY.create);
    setText('[data-role="cards-edit-selected"]', COPY.edit);
    setText('[data-role="cards-delete-selected"]', COPY.remove);
    setText(".cards-sideHead__title", COPY.category);
    setText('[data-role="cards-editor-mode-label"]', COPY.createMode);
    setText('[data-role="cards-editor-title"]', COPY.createTitle);
    setText(".cards-editorHead__desc", COPY.editorDesc);
    setText('[data-role="cards-cancel-editor"]', COPY.backToList);

    if (cardsDom.search) {
        cardsDom.search.placeholder = COPY.searchPlaceholder;
    }
    if (cardsDom.pagePrev) {
        cardsDom.pagePrev.textContent = COPY.pagePrev;
    }
    if (cardsDom.pageNext) {
        cardsDom.pageNext.textContent = COPY.pageNext;
    }
    if (cardsDom.modal?.querySelector(".cards-modal__dialog")) {
        cardsDom.modal.querySelector(".cards-modal__dialog").setAttribute("aria-label", COPY.modalLabel);
    }
}

function renderEditorPreview() {
    if (!cardsDom.preview) {
        return;
    }
    const title = cardsDom.titleInput?.value.trim() || COPY.untitled;
    const category = cardsDom.categoryInput?.value.trim() || COPY.uncategorized;
    const content = cardsDom.contentInput?.value || "";
    const summary = cardsDom.summaryInput?.value.trim();

    cardsDom.preview.innerHTML = `
        <article class="cards-markdown">
            <div class="cards-markdown__meta">
                <span class="cards-markdown__tag">${escapeHtml(category)}</span>
            </div>
            <h3>${escapeHtml(title)}</h3>
            ${summary ? `<p class="cards-markdown__lead">${escapeHtml(summary)}</p>` : ""}
            ${renderMarkdown(content)}
        </article>
    `;
}

function syncSelection() {
    if (!getCardById(cardsState.selectedCardId)) {
        cardsState.selectedCardId = "";
    }
    const hasSelection = Boolean(cardsState.selectedCardId);
    if (cardsDom.editSelectedBtn) {
        cardsDom.editSelectedBtn.disabled = !hasSelection;
    }
    if (cardsDom.deleteSelectedBtn) {
        cardsDom.deleteSelectedBtn.disabled = !hasSelection;
    }
}

function paintSelection() {
    syncSelection();
    if (!cardsDom.grid) {
        return;
    }
    cardsDom.grid.querySelectorAll('[data-role="cards-card"]').forEach((cardEl) => {
        cardEl.classList.toggle("is-selected", cardEl.dataset.cardId === cardsState.selectedCardId);
    });
}

function clearSelection() {
    if (!cardsState.selectedCardId) {
        return;
    }
    cardsState.selectedCardId = "";
    paintSelection();
}

function closeCategorySuggest() {
    if (!cardsDom.categorySuggest) {
        return;
    }
    cardsDom.categorySuggest.hidden = true;
    cardsDom.categorySuggest.innerHTML = "";
}

function setPageMode(mode) {
    cardsState.pageMode = mode;
    if (cardsDom.listPage) {
        cardsDom.listPage.hidden = mode !== "list";
    }
    if (cardsDom.editorPage) {
        cardsDom.editorPage.hidden = mode !== "editor";
    }
    if (cardsDom.root) {
        cardsDom.root.classList.toggle("is-editing", mode === "editor");
    }
    if (cardsDom.hero) {
        cardsDom.hero.hidden = mode !== "list";
    }
    closeCategorySuggest();
}

function setEditorMeta(mode) {
    cardsState.editorMode = mode;
    if (cardsDom.editorModeLabel) {
        cardsDom.editorModeLabel.textContent = mode === "edit" ? COPY.editMode : COPY.createMode;
    }
    if (cardsDom.editorTitle) {
        cardsDom.editorTitle.textContent = mode === "edit" ? COPY.editTitle : COPY.createTitle;
    }
    if (cardsDom.editorDesc) {
        cardsDom.editorDesc.textContent = COPY.editorDesc;
    }
    if (cardsDom.formStatus) {
        cardsDom.formStatus.textContent = mode === "edit" ? COPY.editingUpdate : COPY.localStatus;
    }
}

function resetEditorForm() {
    if (!cardsDom.form) {
        return;
    }
    cardsDom.form.reset();
    cardsDom.form.elements.namedItem("id").value = "";
    if (cardsDom.formStatus) {
        cardsDom.formStatus.textContent = COPY.localStatus;
    }
    closeCategorySuggest();
    cardsState.editorSnapshot = serializeEditorForm();
    renderEditorPreview();
}

function openCreateEditor() {
    if (hasEditorChanges() && !window.confirm(COPY.confirmCreateAbandon)) {
        return;
    }
    resetEditorForm();
    setEditorMeta("create");
    setPageMode("editor");
    renderEditorPreview();
    cardsDom.titleInput?.focus();
}

function openEditEditor(cardId) {
    if (hasEditorChanges() && !window.confirm(COPY.confirmEditAbandon)) {
        return;
    }
    const card = getCardById(cardId);
    if (!card || !cardsDom.form) {
        return;
    }
    resetEditorForm();
    setEditorMeta("edit");
    cardsDom.form.elements.namedItem("id").value = card.id;
    cardsDom.titleInput.value = card.title;
    cardsDom.categoryInput.value = card.category;
    cardsDom.contentInput.value = card.content;
    if (cardsDom.summaryInput) {
        cardsDom.summaryInput.value = card.summary || "";
    }
    if (cardsDom.formStatus) {
        cardsDom.formStatus.textContent = COPY.editHint(card.title);
    }
    setPageMode("editor");
    cardsState.editorSnapshot = serializeEditorForm();
    renderEditorPreview();
    cardsDom.titleInput?.focus();
}

function closeEditor() {
    if (hasEditorChanges() && !window.confirm(COPY.confirmBackAbandon)) {
        return false;
    }
    setPageMode("list");
    return true;
}

function openCardDetail(cardId) {
    const card = getCardById(cardId);
    if (!card || !cardsDom.modal) {
        return;
    }
    cardsDom.modalTitle.textContent = card.title;
    cardsDom.modalCategory.textContent = card.category;
    cardsDom.modalTime.textContent = formatDate(card.updatedAt || card.createdAt);
    cardsDom.modalContent.innerHTML = `<article class="cards-markdown">${renderMarkdown(card.content)}</article>`;
    cardsDom.modal.hidden = false;
}

function closeCardDetail() {
    if (cardsDom.modal) {
        cardsDom.modal.hidden = true;
    }
}

function updateSummary(categories) {
    if (cardsDom.count) {
        cardsDom.count.textContent = String(cardsState.items.length);
    }
    if (cardsDom.categoryCount) {
        cardsDom.categoryCount.textContent = String(categories.length);
    }
    if (cardsDom.categoryCountInline) {
        cardsDom.categoryCountInline.textContent = COPY.categoriesInline(categories.length);
    }
}

function renderFilters(categories) {
    if (!cardsDom.filters) {
        return;
    }

    const allCategories = ["all", ...categories];
    const countMap = new Map();
    cardsState.items.forEach((item) => {
        countMap.set(item.category, (countMap.get(item.category) || 0) + 1);
    });

    cardsDom.filters.innerHTML = allCategories.map((category) => {
        const active = category === cardsState.activeCategory;
        const label = category === "all" ? COPY.allCategories : category;
        const count = category === "all" ? cardsState.items.length : (countMap.get(category) || 0);
        return `
            <button type="button" class="cards-filter${active ? " is-active" : ""}" data-category="${escapeHtml(category)}">
                <span class="cards-filter__text">${escapeHtml(label)}</span>
                <span class="cards-filter__count">${count}</span>
            </button>
        `;
    }).join("");
}

function renderPagination(totalPages, totalItems) {
    if (!cardsDom.pagePrev || !cardsDom.pageNext || !cardsDom.pageList) {
        return;
    }

    cardsDom.pagePrev.disabled = cardsState.currentPage <= 1;
    cardsDom.pageNext.disabled = cardsState.currentPage >= totalPages;

    const shouldShow = (page) => {
        if (page === 1 || page === totalPages) {
            return true;
        }
        return Math.abs(page - cardsState.currentPage) <= 1;
    };

    const pages = [];
    let lastVisible = 0;
    for (let page = 1; page <= totalPages; page += 1) {
        if (!shouldShow(page)) {
            continue;
        }
        if (lastVisible && page - lastVisible > 1) {
            pages.push('<span class="cards-pageEllipsis">...</span>');
        }
        pages.push(`
            <button
                type="button"
                class="cards-pageNum${page === cardsState.currentPage ? " is-active" : ""}"
                data-role="cards-page-num"
                data-page="${page}"
            >${page}</button>
        `);
        lastVisible = page;
    }

    cardsDom.pageList.innerHTML = pages.join("");
    if (cardsDom.pageMeta) {
        cardsDom.pageMeta.textContent = COPY.pageMeta(cardsState.currentPage, totalPages, totalItems);
    }
}

function triggerGridAnimation() {
    if (!cardsDom.grid) {
        return;
    }
    cardsDom.grid.classList.remove("cards-grid--animated");
    void cardsDom.grid.offsetWidth;
    cardsDom.grid.classList.add("cards-grid--animated");
}

function renderGrid() {
    if (!cardsDom.grid) {
        return;
    }

    const {items, totalItems, totalPages} = getPagedCards();
    if (!totalItems) {
        cardsDom.grid.innerHTML = `
            <article class="cards-empty">
                <h4 class="cards-empty__title">${COPY.emptyTitle}</h4>
                <p class="cards-empty__desc">${COPY.emptyDesc}</p>
            </article>
        `;
        renderPagination(1, 0);
        triggerGridAnimation();
        return;
    }

    cardsDom.grid.innerHTML = items.map((item) => {
        const selected = item.id === cardsState.selectedCardId;
        const summary = (typeof item.summary === "string" && item.summary.trim())
            ? item.summary.trim()
            : stripMarkdown(item.content);
        return `
            <article class="cards-card${selected ? " is-selected" : ""}" data-role="cards-card" data-card-id="${escapeHtml(item.id)}" tabindex="0">
                <div class="cards-card__meta">
                    <span class="cards-card__tag">${escapeHtml(item.category || COPY.uncategorized)}</span>
                    <span class="cards-card__time">${escapeHtml(`${COPY.createdPrefix} ${formatDate(item.createdAt)}`)}</span>
                </div>
                <h4 class="cards-card__title">${escapeHtml(item.title || COPY.untitled)}</h4>
                <p class="cards-card__excerpt">${escapeHtml(summary)}</p>
                <div class="cards-card__footer">
                    <span class="cards-card__source">${escapeHtml(`${COPY.creatorPrefix} ${item.source || "user"}`)}</span>
                    <div class="cards-card__actions">
                        <button type="button" class="cards-card__btn" data-action="edit">${COPY.edit}</button>
                        <button type="button" class="cards-card__btn cards-card__btn--danger" data-action="delete">${COPY.remove}</button>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    renderPagination(totalPages, totalItems);
    triggerGridAnimation();
}

function applyCardsData(data) {
    cardsState.items = Array.isArray(data?.items) ? data.items : [];
    const categories = Array.isArray(data?.categories) ? data.categories : getCategories();
    if (cardsState.activeCategory !== "all" && !categories.includes(cardsState.activeCategory)) {
        cardsState.activeCategory = "all";
    }
    updateSummary(categories);
    renderFilters(categories);
    renderGrid();
    paintSelection();
    renderCategorySuggest();
    if (cardsState.pageMode === "editor") {
        cardsState.editorSnapshot = serializeEditorForm();
        renderEditorPreview();
    }
}

async function syncCards() {
    if (!window.api?.loadKnowledgeCards) {
        return;
    }
    const data = await window.api.loadKnowledgeCards();
    applyCardsData(data);
    cardsState.loaded = true;
}

function getSuggestedCategories() {
    const categories = getCategories();
    const query = (cardsDom.categoryInput?.value || "").trim().toLowerCase();
    if (!query) {
        return categories.slice(0, 8);
    }
    return categories.filter((category) => category.toLowerCase().includes(query)).slice(0, 8);
}

function renderCategorySuggest() {
    if (!cardsDom.categorySuggest || cardsState.pageMode !== "editor") {
        return;
    }
    const suggestions = getSuggestedCategories();
    if (!suggestions.length) {
        closeCategorySuggest();
        return;
    }
    cardsDom.categorySuggest.innerHTML = suggestions.map((category) => `
        <button type="button" class="cards-suggest__item" data-role="cards-suggest-item" data-value="${escapeHtml(category)}">
            ${escapeHtml(category)}
        </button>
    `).join("");
    cardsDom.categorySuggest.hidden = false;
}

async function deleteCard(cardId) {
    const card = getCardById(cardId);
    if (!card || !window.api?.deleteKnowledgeCard) {
        return;
    }
    if (!window.confirm(COPY.confirmDelete(card.title))) {
        return;
    }
    const data = await window.api.deleteKnowledgeCard(cardId);
    if (cardsState.selectedCardId === cardId) {
        cardsState.selectedCardId = "";
    }
    applyCardsData(data);
    closeCardDetail();
    closeEditor();
}

function wireFilters() {
    cardsDom.filters?.addEventListener("click", (event) => {
        const button = event.target.closest(".cards-filter");
        if (!button) {
            return;
        }
        cardsState.activeCategory = button.dataset.category || "all";
        cardsState.currentPage = 1;
        renderFilters(getCategories());
        renderGrid();
        paintSelection();
    });
}

function wireSearch() {
    cardsDom.search?.addEventListener("input", (event) => {
        cardsState.query = event.target.value || "";
        cardsState.currentPage = 1;
        renderGrid();
        paintSelection();
    });
}

function wirePagination() {
    cardsDom.pagePrev?.addEventListener("click", () => {
        if (cardsState.currentPage <= 1) {
            return;
        }
        cardsState.currentPage -= 1;
        renderGrid();
        paintSelection();
    });

    cardsDom.pageNext?.addEventListener("click", () => {
        const totalPages = Math.max(1, Math.ceil(getVisibleCards().length / PAGE_SIZE));
        if (cardsState.currentPage >= totalPages) {
            return;
        }
        cardsState.currentPage += 1;
        renderGrid();
        paintSelection();
    });

    cardsDom.pageList?.addEventListener("click", (event) => {
        const button = event.target.closest('[data-role="cards-page-num"]');
        if (!button) {
            return;
        }
        cardsState.currentPage = Number(button.dataset.page || 1);
        renderGrid();
        paintSelection();
    });
}

function wireToolbar() {
    cardsDom.createBtn?.addEventListener("click", openCreateEditor);
    cardsDom.editSelectedBtn?.addEventListener("click", () => {
        if (cardsState.selectedCardId) {
            openEditEditor(cardsState.selectedCardId);
        }
    });
    cardsDom.deleteSelectedBtn?.addEventListener("click", async () => {
        if (cardsState.selectedCardId) {
            await deleteCard(cardsState.selectedCardId);
        }
    });
}

function wireCategoryPicker() {
    cardsDom.categoryInput?.addEventListener("focus", renderCategorySuggest);
    cardsDom.categoryInput?.addEventListener("input", renderCategorySuggest);
    cardsDom.categoryInput?.addEventListener("blur", () => {
        window.setTimeout(() => {
            closeCategorySuggest();
        }, 120);
    });
    cardsDom.categorySuggest?.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });
    cardsDom.categorySuggest?.addEventListener("click", (event) => {
        const item = event.target.closest('[data-role="cards-suggest-item"]');
        if (!item || !cardsDom.categoryInput) {
            return;
        }
        cardsDom.categoryInput.value = item.dataset.value || "";
        closeCategorySuggest();
        renderEditorPreview();
        cardsDom.categoryInput.focus();
    });
}

function wireComposer() {
    const syncPreview = () => {
        renderEditorPreview();
        if (cardsDom.formStatus && cardsState.pageMode === "editor") {
            cardsDom.formStatus.textContent = cardsState.editorMode === "edit" ? COPY.editingUpdate : COPY.editingCreate;
        }
    };

    cardsDom.titleInput?.addEventListener("input", syncPreview);
    cardsDom.categoryInput?.addEventListener("input", syncPreview);
    cardsDom.contentInput?.addEventListener("input", syncPreview);
    cardsDom.summaryTrigger?.addEventListener("click", async () => {
        if (!window.api?.generateKnowledgeCardSummary || !cardsDom.titleInput || !cardsDom.contentInput) {
            return;
        }
        const title = cardsDom.titleInput.value.trim();
        const content = cardsDom.contentInput.value.trim();
        if (!title || !content) {
            if (cardsDom.formStatus) {
                cardsDom.formStatus.textContent = "请先填写标题和正文，再生成摘要。";
            }
            return;
        }
        const button = cardsDom.summaryTrigger;
        button.disabled = true;
        if (cardsDom.formStatus) {
            cardsDom.formStatus.textContent = COPY.summaryGenerating;
        }
        try {
            const result = await window.api.generateKnowledgeCardSummary({
                title,
                content,
                category: cardsDom.categoryInput?.value || "",
                source: "user",
            });
            if (cardsDom.summaryInput) {
                cardsDom.summaryInput.value = result?.summary || "";
            }
            syncPreview();
        } catch (error) {
            if (cardsDom.formStatus) {
                cardsDom.formStatus.textContent = error?.message || "摘要生成失败";
            }
        } finally {
            button.disabled = false;
        }
    });

    cardsDom.form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = cardsDom.form.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = true;
        }
        if (cardsDom.formStatus) {
            cardsDom.formStatus.textContent = cardsState.editorMode === "edit" ? COPY.savingUpdate : COPY.savingCreate;
        }

        const formData = new FormData(cardsDom.form);
        const payload = {
            id: String(formData.get("id") || "").trim(),
            title: String(formData.get("title") || "").trim(),
            category: String(formData.get("category") || "").trim(),
            content: String(formData.get("content") || ""),
            summary: String(formData.get("summary") || "").trim(),
            source: "user",
        };

        try {
            const result = cardsState.editorMode === "edit"
                ? await window.api.updateKnowledgeCard(payload)
                : await window.api.createKnowledgeCard(payload);

            cardsState.currentPage = 1;
            cardsState.selectedCardId = result?.card?.id || "";
            applyCardsData(result?.data || {items: []});
            closeEditor();

            if (cardsDom.formStatus) {
                const prefix = cardsState.editorMode === "edit" ? COPY.savedUpdate : COPY.savedCreate;
                cardsDom.formStatus.textContent = `${prefix}${result?.card?.title || payload.title || COPY.untitled}`;
            }
        } catch (error) {
            if (cardsDom.formStatus) {
                cardsDom.formStatus.textContent = error?.message || "Save failed";
            }
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    });
}

function wireGrid() {
    cardsDom.grid?.addEventListener("click", async (event) => {
        const cardEl = event.target.closest('[data-role="cards-card"]');
        if (!cardEl) {
            if (!event.target.closest(".cards-empty")) {
                clearSelection();
            }
            return;
        }

        const cardId = cardEl.dataset.cardId || "";
        const actionBtn = event.target.closest(".cards-card__btn");

        cardsState.selectedCardId = cardId;
        paintSelection();

        if (!actionBtn) {
            return;
        }
        if (actionBtn.dataset.action === "edit") {
            openEditEditor(cardId);
            return;
        }
        if (actionBtn.dataset.action === "delete") {
            await deleteCard(cardId);
        }
    });

    cardsDom.grid?.addEventListener("dblclick", (event) => {
        const cardEl = event.target.closest('[data-role="cards-card"]');
        if (!cardEl || event.target.closest(".cards-card__btn")) {
            return;
        }
        const cardId = cardEl.dataset.cardId || "";
        cardsState.selectedCardId = cardId;
        paintSelection();
        openCardDetail(cardId);
    });

    cardsDom.grid?.addEventListener("keydown", (event) => {
        const cardEl = event.target.closest('[data-role="cards-card"]');
        if (!cardEl) {
            return;
        }
        const cardId = cardEl.dataset.cardId || "";
        if (event.key === " ") {
            event.preventDefault();
            cardsState.selectedCardId = cardId;
            paintSelection();
        }
        if (event.key === "Enter") {
            event.preventDefault();
            cardsState.selectedCardId = cardId;
            paintSelection();
            openCardDetail(cardId);
        }
    });
}

function wireBlankSelectionClear() {
    cardsDom.listPage?.addEventListener("click", (event) => {
        if (event.target.closest('[data-role="cards-card"]')) return;
        if (event.target.closest(".cards-toolbar")) return;
        if (event.target.closest(".cards-filter")) return;
        if (event.target.closest(".cards-pageBtn")) return;
        if (event.target.closest(".cards-pageNum")) return;
        if (event.target.closest(".cards-browser__side")) return;
        clearSelection();
    });
}

function wireModal() {
    cardsDom.modal?.addEventListener("click", (event) => {
        if (event.target.closest('[data-role="cards-modal-close"]')) {
            closeCardDetail();
        }
    });

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && cardsDom.modal && !cardsDom.modal.hidden) {
            closeCardDetail();
        }
    });
}

function wireUnsavedGuard() {}

function wireViewSync() {
    window.addEventListener("shell:viewchange", async (event) => {
        if (event.detail?.viewKey !== "cards") {
            return;
        }
        setPageMode("list");
        await syncCards();
    });
}

function wireEditorButtons() {
    cardsDom.cancelEditorBtns.forEach((button) => {
        button.addEventListener("click", () => {
            closeEditor();
        });
    });
}

function bootCards() {
    if (!cardsDom.grid) {
        return;
    }

    rebuildEditorForm();
    refreshEditorDom();
    normalizeCardsCopy();
    renderEditorPreview();
    setPageMode("list");
    paintSelection();

    wireFilters();
    wireSearch();
    wirePagination();
    wireToolbar();
    wireCategoryPicker();
    wireComposer();
    wireGrid();
    wireBlankSelectionClear();
    wireModal();
    wireUnsavedGuard();
    wireViewSync();
    wireEditorButtons();
}

document.addEventListener("DOMContentLoaded", bootCards);
