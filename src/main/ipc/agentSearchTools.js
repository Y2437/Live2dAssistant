const {
    clampTraceOutput,
    safeJsonParse,
    stripMarkdown,
    summarizeText,
    requestText,
    decodeHtmlEntities,
    htmlToPlainText,
    unwrapDuckDuckGoUrl,
} = require("./agentShared");
const {
    buildAgentPlanningSystemPrompt: buildPlanningPromptTemplate,
    NO_RECENT_CONTEXT_TEXT,
    NO_LONG_TERM_MEMORY_TEXT,
} = require("./promptRegistry");
// Search, prompt, and tool-planning helpers for the agent loop.

function rankByNeedle(items, buildHaystack, needle, limit = 16) {
    const value = String(needle || "").trim().toLowerCase();
    const tokens = value.split(/\s+/).filter(Boolean);
    return items
        .map((item) => {
            const haystack = String(buildHaystack(item) || "").toLowerCase();
            let score = 0;
            if (!value) {
                score = 1;
            } else {
                if (haystack.includes(value)) {
                    score += 10;
                }
                for (const token of tokens) {
                    if (token && haystack.includes(token)) {
                        score += token.length > 3 ? 3 : 2;
                    }
                }
            }
            return {item, score};
        })
        .filter((entry) => !value || entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.item);
}

function searchMemory(service, query) {
    const needle = String(query || "").trim().toLowerCase();
    const items = rankByNeedle(service.getLongTermMemory()
        .filter((item) => item.status !== "archived")
    , (item) => `${item.title}\n${item.content}\n${item.source || ""}\n${item.category || ""}\n${(item.tags || []).join(" ")}`, needle, 16)
        .map((item) => ({
            id: item.id,
            title: item.title,
            content: item.content,
            contentPreview: summarizeText(item.content, 320),
            source: item.source || "manual",
            category: item.category || "reference",
            tags: item.tags || [],
            confidence: item.confidence ?? null,
            updatedAt: item.updatedAt || "",
        }));
    return {items};
}

function searchCards(service, query) {
    const needle = String(query || "").trim().toLowerCase();
    const items = rankByNeedle(service.getKnowledgeCards(), (item) => `${item.title}\n${item.category}\n${item.summary || ""}\n${item.content}`, needle, 12)
        .map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            summary: item.summary || summarizeText(item.content, 120),
            contentPreview: summarizeText(item.content, 320),
            content: String(item.content || "").length > 2400
                ? `${String(item.content || "").slice(0, 2400).trim()}...`
                : String(item.content || ""),
            updatedAt: item.updatedAt || item.createdAt || "",
        }));
    return {items};
}

function listCards(service, category) {
    const needle = String(category || "").trim().toLowerCase();
    const sourceItems = needle
        ? service.getKnowledgeCards().filter((item) => String(item.category || "").toLowerCase() === needle)
        : service.getKnowledgeCards();
    const items = sourceItems
        .slice(0, 20)
        .map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            summary: item.summary || summarizeText(item.content, 120),
            contentPreview: summarizeText(item.content, 320),
            content: String(item.content || "").length > 2400
                ? `${String(item.content || "").slice(0, 2400).trim()}...`
                : String(item.content || ""),
            updatedAt: item.updatedAt || item.createdAt || "",
        }));
    return {items};
}

function getCard(service, args) {
    const id = String(args?.id || "").trim();
    const title = String(args?.title || "").trim().toLowerCase();
    const cards = service.getKnowledgeCards();
    const card = cards.find((item) => {
        const itemTitle = String(item.title || "").trim().toLowerCase();
        return (id && item.id === id)
            || (title && itemTitle === title);
    }) || cards.find((item) => {
        const itemTitle = String(item.title || "").trim().toLowerCase();
        return title && (itemTitle.includes(title) || title.includes(itemTitle));
    });
    if (!card) {
        throw new Error("Card not found.");
    }
    return card;
}

function parseAgentResponse(content) {
    const text = String(content || "").trim();
    const direct = safeJsonParse(text);
    if (direct) return direct;
    const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
    if (match) {
        const parsed = safeJsonParse(match[1].trim());
        if (parsed) return parsed;
    }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const parsed = safeJsonParse(text.slice(firstBrace, lastBrace + 1));
        if (parsed) return parsed;
    }
    for (let start = 0; start < text.length; start += 1) {
        if (text[start] !== "{") {
            continue;
        }
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < text.length; index += 1) {
            const char = text[index];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === '"') {
                inString = !inString;
                continue;
            }
            if (inString) {
                continue;
            }
            if (char === "{") {
                depth += 1;
            } else if (char === "}") {
                depth -= 1;
                if (depth === 0) {
                    const candidate = safeJsonParse(text.slice(start, index + 1));
                    if (candidate && typeof candidate === "object" && candidate.type) {
                        return candidate;
                    }
                    break;
                }
            }
        }
    }
    return null;
}

function buildPrefetchPlan(userMessage) {
    return [];
}

async function runPrefetchTools(service, userMessage, traces, conversation, options = {}) {
    const plan = Array.isArray(options.plan) ? options.plan : buildPrefetchPlan(userMessage);
    for (const item of plan) {
        try {
            const result = await service.runTool(item.tool, item.args, options.allowedTools);
            const trace = {tool: item.tool, status: "success", input: item.args, outputPreview: clampTraceOutput(result), phase: "prefetch"};
            traces.push(trace);
            if (options.onTrace) {
                await options.onTrace(trace, traces);
            }
            conversation.push({
                role: "user",
                content: [{type: "text", text: `Prefetched tool result for ${item.tool}: ${JSON.stringify(result)}`}],
            });
        } catch (error) {
            const trace = {
                tool: item.tool,
                status: "error",
                input: item.args,
                outputPreview: clampTraceOutput({error: error?.message || String(error)}),
                phase: "prefetch",
            };
            traces.push(trace);
            if (options.onTrace) {
                await options.onTrace(trace, traces);
            }
        }
    }
}

function buildAgentPlanningSystemPrompt(memories, context, allowedTools = null) {
    const memoryText = memories.length ? memories.map((item, index) => `${index + 1}. ${item.title}: ${item.content}`).join("\n") : NO_LONG_TERM_MEMORY_TEXT;
    const contextText = context.length ? context.map((item) => `${item.role}: ${summarizeText(item.message, 120)}`).join("\n") : NO_RECENT_CONTEXT_TEXT;
    return buildPlanningPromptTemplate({contextText, memoryText, allowedTools});
}

async function runTool(service, toolName, args) {
    switch (toolName) {
    case "get_context": return {items: service.getAssistantContext().slice(-16)};
    case "get_memory": return {items: service.getLongTermMemory()};
    case "search_memory": return service.searchMemory(args?.query);
    case "get_memory_routine_status": return service.getMemoryRoutineMeta();
    case "add_memory": return service.addLongTermMemory(args);
    case "delete_memory": return service.deleteLongTermMemory(args?.id);
    case "extract_memory": return service.extractLongTermMemories();
    case "list_cards": return service.listCards(args?.category);
    case "search_cards": return service.searchCards(args?.query);
    case "get_card": return service.getCard(args);
    case "create_card": return service.createKnowledgeCard(args);
    case "get_pomodoro_status": return service.getPomodoroStatus();
    case "get_clipboard": return service.getClipboardSnapshot();
    case "analyze_clipboard_image": return service.analyzeClipboardImage(args);
    case "get_library_overview": return service.getLibraryOverview();
    case "search_library": return service.searchLibrary(args?.query);
    case "read_library_file": return service.readLibraryFile(args?.path);
    case "web_search": return service.webSearch(args?.query);
    case "read_web_page": return service.readWebPage(args?.url);
    case "capture_screen": return service.captureScreen(args?.name);
    case "list_screenshots": return service.listScreenshots();
    case "analyze_image": return service.analyzeImage(args);
    default: throw new Error(`Unknown tool: ${toolName}`);
    }
}

async function readWebPage(service, url) {
    const value = String(url || "").trim();
    if (!value) {
        throw new Error("Page url is required.");
    }
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    const html = await requestText(value, headers);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageText = htmlToPlainText(html);
    return {
        url: value,
        title: stripMarkdown(decodeHtmlEntities(titleMatch?.[1] || "")),
        contentPreview: summarizeText(pageText, 1200),
        content: pageText.length > 5000 ? `${pageText.slice(0, 5000).trim()}...` : pageText,
    };
}

async function webSearch(service, query) {
    const value = String(query || "").trim();
    if (!value) throw new Error("Search query is required.");
    const requestHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    const attempts = [
        {
            name: "bing-rss",
            url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(value)}`,
            parse(xml) {
                const results = [];
                const pattern = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>(?:[\s\S]*?<description>([\s\S]*?)<\/description>)?[\s\S]*?<\/item>/gi;
                let match;
                while ((match = pattern.exec(xml)) && results.length < 8) {
                    results.push({
                        title: stripMarkdown(decodeHtmlEntities(match[1])),
                        url: decodeHtmlEntities(match[2].trim()),
                        snippet: summarizeText(decodeHtmlEntities(match[3] || ""), 220),
                    });
                }
                return results;
            },
        },
        {
            name: "bing",
            url: `https://www.bing.com/search?q=${encodeURIComponent(value)}`,
            parse(html) {
                const results = [];
                const pattern = /<li class="b_algo"[\s\S]*?<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)(?=<li class="b_algo"|$)/gi;
                let match;
                while ((match = pattern.exec(html)) && results.length < 8) {
                    const block = match[3] || "";
                    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || block.match(/class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
                    results.push({
                        title: stripMarkdown(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))),
                        url: decodeHtmlEntities(match[1]),
                        snippet: summarizeText(decodeHtmlEntities((snippetMatch?.[1] || "").replace(/<[^>]+>/g, " ")), 220),
                    });
                }
                return results;
            },
        },
        {
            name: "duckduckgo",
            url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(value)}`,
            parse(html) {
                const results = [];
                const pattern = /<div[^>]*class="[^"]*result[^"]*"[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<div[^>]*class="[^"]*result[^"]*"|$)/gi;
                let match;
                while ((match = pattern.exec(html)) && results.length < 8) {
                    const block = match[3] || "";
                    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
                        || block.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                    results.push({
                        title: stripMarkdown(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))),
                        url: unwrapDuckDuckGoUrl(decodeHtmlEntities(match[1])),
                        snippet: summarizeText(decodeHtmlEntities((snippetMatch?.[1] || "").replace(/<[^>]+>/g, " ")), 220),
                    });
                }
                return results;
            },
        },
    ];

    async function fetchResultContent(result) {
        try {
            const html = await requestText(result.url, requestHeaders);
            const pageText = htmlToPlainText(html);
            if (!pageText) {
                return {
                    ...result,
                    contentPreview: "",
                    contentStatus: "empty",
                };
            }
            return {
                ...result,
                contentPreview: summarizeText(pageText, 1200),
                content: pageText.length > 4000 ? `${pageText.slice(0, 4000).trim()}...` : pageText,
                contentStatus: "ok",
            };
        } catch (error) {
            return {
                ...result,
                contentPreview: result.snippet || "",
                contentStatus: "error",
                contentError: error?.message || String(error),
            };
        }
    }

    let lastError = "";
    for (const attempt of attempts) {
        try {
            const html = await requestText(attempt.url, requestHeaders);
            const results = attempt.parse(html).filter((item) => item.title && item.url);
            if (results.length) {
                const enrichedResults = [];
                for (let index = 0; index < results.length; index += 1) {
                    const result = results[index];
                    if (index < 3) {
                        enrichedResults.push(await fetchResultContent(result));
                    } else {
                        enrichedResults.push({
                            ...result,
                            contentPreview: result.snippet || "",
                            contentStatus: "skipped",
                        });
                    }
                }
                return {query: value, provider: attempt.name, results: enrichedResults};
            }
            lastError = `${attempt.name} returned no parsable results`;
        } catch (error) {
            lastError = error?.message || String(error);
        }
    }
    return {query: value, provider: "unavailable", results: [], error: lastError || "Web search is temporarily unavailable."};
}

module.exports = {searchMemory, searchCards, listCards, getCard, parseAgentResponse, buildPrefetchPlan, runPrefetchTools, buildAgentPlanningSystemPrompt, runTool, webSearch, readWebPage};
