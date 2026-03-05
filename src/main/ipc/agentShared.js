const http = require("http");
const https = require("https");

const MAX_AGENT_STEPS = 20;
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_FILE_RESULT_CHARS = 12000;
const MAX_CHUNKS_PER_FILE = 48;
const CHUNK_TARGET_CHARS = 900;
const CHUNK_OVERLAP_CHARS = 180;
const IGNORED_DIRS = new Set([".git", "node_modules", "out", ".idea", "dist", "build"]);
const SEARCH_FILLER_PATTERNS = [
    /^(请|麻烦|帮我|帮忙|拜托|想请你|我想|我想让你|我想知道|想知道|能不能|可以不可以|可不可以)/i,
    /^(查一下|搜一下|搜一搜|搜索一下|找一下|看一下|看一看|查查|搜搜|看看)/i,
    /^(帮我查一下|帮我搜一下|帮我搜索一下|帮我找一下|帮我看一下)/i,
];
const SEARCH_SPLIT_PATTERNS = /(以及|还有|还有关于|和|与|及|并且|并|或者|或|相关|有关|关于|里面|里|中的|中|下的|下|的|了|呢|吧|呀|啊|嘛|么|,|，|;|；|\||\/|\band\b|\bor\b)/gi;

function isoNow() {
    return new Date().toISOString();
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

function stripMarkdown(text) {
    return String(text || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/[#>*_~-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function summarizeText(text, maxLength = 240) {
    const plain = stripMarkdown(text);
    if (!plain) {
        return "";
    }
    return plain.length > maxLength ? `${plain.slice(0, maxLength).trim()}...` : plain;
}

function sanitizeFileName(value) {
    return String(value || "capture")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || "capture";
}

function clampTraceOutput(value, maxLength = 600) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) {
        return "";
    }
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeToolArgs(args) {
    if (args && typeof args === "object" && !Array.isArray(args)) {
        return args;
    }
    return {};
}

function unwrapDuckDuckGoUrl(url) {
    try {
        const parsed = new URL(url, "https://duckduckgo.com");
        const uddg = parsed.searchParams.get("uddg");
        return uddg ? decodeURIComponent(uddg) : url;
    } catch (error) {
        return url;
    }
}

function requestText(url, headers = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const transport = target.protocol === "https:" ? https : http;
        const request = transport.request(target, {
            method: "GET",
            headers,
        }, (response) => {
            const statusCode = response.statusCode || 0;
            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                if (redirectCount >= 5) {
                    reject(new Error(`Too many redirects for ${url}`));
                    return;
                }
                const nextUrl = new URL(response.headers.location, target).toString();
                response.resume();
                requestText(nextUrl, headers, redirectCount + 1).then(resolve).catch(reject);
                return;
            }
            if (statusCode < 200 || statusCode >= 300) {
                let errorBody = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    errorBody += chunk;
                });
                response.on("end", () => {
                    reject(new Error(`status ${statusCode}${errorBody ? ` body=${errorBody.slice(0, 200)}` : ""}`));
                });
                return;
            }
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                body += chunk;
            });
            response.on("end", () => {
                resolve(body);
            });
        });
        request.on("error", (error) => {
            reject(error);
        });
        request.setTimeout(15000, () => {
            request.destroy(new Error(`timeout for ${url}`));
        });
        request.end();
    });
}

function decodeHtmlEntities(text) {
    return String(text || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function htmlToPlainText(html) {
    return decodeHtmlEntities(String(html || ""))
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, " $1 ")
        .replace(/<img[^>]*>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>|<\/div>|<\/section>|<\/article>|<\/li>|<\/h[1-6]>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[^\S\n]{2,}/g, " ")
        .trim();
}

function tokenizeSearchText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, " ")
        .split(/\s+/)
        .filter((item) => item && item.length > 1)
        .filter((item, index, array) => array.indexOf(item) === index)
        .slice(0, 48);
}

function normalizeSearchInput(text) {
    let value = String(text || "").trim();
    if (!value) {
        return "";
    }
    for (const pattern of SEARCH_FILLER_PATTERNS) {
        value = value.replace(pattern, "").trim();
    }
    return value
        .replace(/[“”"'`]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildSearchVariants(text) {
    const original = String(text || "").trim();
    if (!original) {
        return [];
    }
    const normalized = normalizeSearchInput(original);
    const candidates = [];
    const pushVariant = (value, weight = 1) => {
        const next = String(value || "").trim().toLowerCase();
        if (!next || next.length < 2) {
            return;
        }
        if (!candidates.some((item) => item.text === next)) {
            candidates.push({
                text: next,
                tokens: tokenizeSearchText(next),
                weight,
            });
        }
    };

    pushVariant(original, 1.6);
    if (normalized && normalized.toLowerCase() !== original.toLowerCase()) {
        pushVariant(normalized, 1.35);
    }

    const parts = (normalized || original)
        .replace(SEARCH_SPLIT_PATTERNS, " ")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2);
    parts.forEach((item) => pushVariant(item, 1.05));

    const normalizedTokens = tokenizeSearchText((normalized || original).replace(SEARCH_SPLIT_PATTERNS, " "));
    if (normalizedTokens.length > 1) {
        pushVariant(normalizedTokens.join(" "), 1.2);
    }
    normalizedTokens.forEach((item) => pushVariant(item, 0.8));
    for (let index = 0; index < normalizedTokens.length - 1; index += 1) {
        pushVariant(`${normalizedTokens[index]} ${normalizedTokens[index + 1]}`, 0.95);
    }

    return candidates.slice(0, 12);
}

function scoreSearchMatch(query, haystack, tokens, weight = 1) {
    const text = String(haystack || "").toLowerCase();
    let score = 0;
    if (query && text.includes(query)) {
        score += 8 * weight;
    }
    for (const token of tokens) {
        if (!token) {
            continue;
        }
        if (text.includes(token)) {
            score += (token.length > 4 ? 3 : 2) * weight;
        }
    }
    return score;
}

function scoreSearchVariants(haystack, variants = [], weight = 1) {
    return variants.reduce((sum, item) => (
        sum + scoreSearchMatch(item.text, haystack, item.tokens || [], (item.weight || 1) * weight)
    ), 0);
}

module.exports = {
    MAX_AGENT_STEPS,
    MAX_FILE_SIZE,
    MAX_FILE_RESULT_CHARS,
    IGNORED_DIRS,
    isoNow,
    safeJsonParse,
    stripMarkdown,
    summarizeText,
    sanitizeFileName,
    clampTraceOutput,
    normalizeToolArgs,
    unwrapDuckDuckGoUrl,
    requestText,
    decodeHtmlEntities,
    htmlToPlainText,
    tokenizeSearchText,
    normalizeSearchInput,
    buildSearchVariants,
    scoreSearchMatch,
    scoreSearchVariants,
};
