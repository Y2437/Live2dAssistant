const MEMORY_CATEGORIES = new Set(["identity", "preference", "project", "constraint", "plan", "relationship", "workflow", "reference", "other"]);
const DEFAULT_CARD_CATEGORY = "未分类";

function normalizeAssistantContext(data) {
    if (!Array.isArray(data)) {
        return [];
    }
    return data.filter((item) => {
        return item
            && (item.role === "user" || item.role === "assistant")
            && typeof item.message === "string"
            && item.message.trim() !== "";
    }).map((item) => ({role: item.role, message: item.message}));
}

function normalizeMemoryCategory(value, title = "", content = "") {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw && MEMORY_CATEGORIES.has(raw)) {
        return raw;
    }
    const haystack = `${title}\n${content}`.toLowerCase();
    if (/(prefer|like|favorite|习惯|喜欢|偏好|常用)/.test(haystack)) {
        return "preference";
    }
    if (/(project|repo|code|feature|项目|功能|实现|开发)/.test(haystack)) {
        return "project";
    }
    if (/(must|need to|constraint|限制|不要|必须|仅限)/.test(haystack)) {
        return "constraint";
    }
    if (/(plan|todo|next|后续|下一步|计划)/.test(haystack)) {
        return "plan";
    }
    if (/(workflow|process|流程|节奏)/.test(haystack)) {
        return "workflow";
    }
    if (/(friend|family|teammate|关系|人物)/.test(haystack)) {
        return "relationship";
    }
    if (/(name|identity|身份|设定|角色)/.test(haystack)) {
        return "identity";
    }
    return "reference";
}

function normalizeMemoryTags(value, title = "", content = "") {
    const tags = Array.isArray(value) ? value : [];
    const normalized = tags
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim().toLowerCase())
        .filter((item, index, array) => array.indexOf(item) === index)
        .slice(0, 8);
    if (normalized.length) {
        return normalized;
    }
    const source = `${title} ${content}`.toLowerCase();
    const candidates = source.match(/[a-z0-9][a-z0-9._-]{1,23}|[\u4e00-\u9fa5]{2,8}/g) || [];
    return candidates
        .filter((item) => !["today", "hello", "assistant", "user", "今天", "刚刚", "可以", "需要"].includes(item))
        .filter((item, index, array) => array.indexOf(item) === index)
        .slice(0, 6);
}

function normalizeMemoryConfidence(value) {
    const number = Number(value);
    if (Number.isFinite(number)) {
        return Math.max(0.2, Math.min(1, Number(number.toFixed(2))));
    }
    return 0.72;
}

function normalizeMemoryStatus(value) {
    return value === "archived" ? "archived" : "active";
}

function buildMemoryFingerprint(title, content) {
    return `${title}\n${content}`
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .slice(0, 20)
        .join("|");
}

function isMemoryNoise(title, content) {
    const text = `${title}\n${content}`.trim();
    if (text.length < 12) {
        return true;
    }
    return /(你好|晚安|早上好|谢谢|收到|ok|好的|拜拜|hello|good night|thank you)/i.test(text)
        || /(今天聊了|刚刚聊了|本次对话|这次聊天|temporary|one-off)/i.test(text);
}

function normalizeLongTermMemory(data) {
    if (!Array.isArray(data)) {
        return [];
    }
    return data.filter((item) => {
        return item
            && typeof item.title === "string"
            && item.title.trim() !== ""
            && typeof item.content === "string";
    }).map((item) => ({
        id: item.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: item.title.trim(),
        content: item.content.trim(),
        source: typeof item.source === "string" ? item.source : "manual",
        category: normalizeMemoryCategory(item.category, item.title, item.content),
        tags: normalizeMemoryTags(item.tags, item.title, item.content),
        confidence: normalizeMemoryConfidence(item.confidence),
        status: normalizeMemoryStatus(item.status),
        fingerprint: buildMemoryFingerprint(item.title, item.content),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    }));
}

function normalizeMemoryRoutineMeta(defaultMeta, data) {
    if (!data || typeof data !== "object") {
        return {...defaultMeta};
    }
    return {
        lastExtractionDate: typeof data.lastExtractionDate === "string" ? data.lastExtractionDate : "",
        lastRunAt: typeof data.lastRunAt === "string" ? data.lastRunAt : "",
        lastStatus: typeof data.lastStatus === "string" ? data.lastStatus : "idle",
        lastAddedCount: Number.isFinite(Number(data.lastAddedCount)) ? Number(data.lastAddedCount) : 0,
        lastSkippedCount: Number.isFinite(Number(data.lastSkippedCount)) ? Number(data.lastSkippedCount) : 0,
        lastError: typeof data.lastError === "string" ? data.lastError : "",
    };
}

function stripMarkdownForSummary(content) {
    return String(content || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/^(#{1,6}\s+)/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/^[-*]\s+/gm, "")
        .replace(/^\d+\.\s+/gm, "")
        .replace(/[*_~]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildKnowledgeCardFallbackSummary(data) {
    const plain = stripMarkdownForSummary(data?.content || "");
    if (!plain) {
        return typeof data?.title === "string" ? data.title.trim() : "";
    }
    return plain.length > 84 ? `${plain.slice(0, 84).trim()}...` : plain;
}

function normalizeKnowledgeCards(data) {
    if (!Array.isArray(data)) {
        return [];
    }
    return data.filter((item) => {
        return item
            && typeof item.title === "string"
            && item.title.trim() !== ""
            && typeof item.content === "string";
    }).map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: item.title.trim(),
        content: item.content.trim(),
        summary: typeof item.summary === "string" && item.summary.trim()
            ? item.summary.trim()
            : buildKnowledgeCardFallbackSummary(item),
        category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : DEFAULT_CARD_CATEGORY,
        source: typeof item.source === "string" && item.source.trim() ? item.source.trim() : "user",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    }));
}

function validateKnowledgeCardPayload(data, options = {}) {
    const title = typeof data?.title === "string" ? data.title.trim() : "";
    const content = typeof data?.content === "string" ? data.content.trim() : "";
    if (!title) {
        throw new Error("Card title is required.");
    }
    if (!content) {
        throw new Error("Card content is required.");
    }
    return {
        id: options.requireId ? (typeof data?.id === "string" ? data.id.trim() : "") : "",
        title,
        content,
        summary: typeof data?.summary === "string" ? data.summary.trim() : "",
        category: typeof data?.category === "string" && data.category.trim() ? data.category.trim() : DEFAULT_CARD_CATEGORY,
        source: typeof data?.source === "string" && data.source.trim() ? data.source.trim() : "user",
    };
}

function buildKnowledgeCardSummaryMessages(data) {
    return [
        {
            role: "system",
            message: "你是知识卡片摘要助手。请基于标题、分类和正文，生成一条简洁客观的中文摘要。要求：1. 18到48字；2. 不使用 Markdown；3. 不使用项目符号；4. 不重复标题；5. 只输出摘要正文。",
        },
        {
            role: "user",
            message: `标题: ${data.title}\n分类: ${data.category}\n正文: ${data.content}`,
        },
    ];
}

module.exports = {
    DEFAULT_CARD_CATEGORY,
    normalizeAssistantContext,
    normalizeMemoryCategory,
    normalizeMemoryTags,
    normalizeMemoryConfidence,
    normalizeMemoryStatus,
    buildMemoryFingerprint,
    isMemoryNoise,
    normalizeLongTermMemory,
    normalizeMemoryRoutineMeta,
    stripMarkdownForSummary,
    buildKnowledgeCardFallbackSummary,
    normalizeKnowledgeCards,
    validateKnowledgeCardPayload,
    buildKnowledgeCardSummaryMessages,
};
