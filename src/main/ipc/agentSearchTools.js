const {
    clampTraceOutput,
    safeJsonParse,
    stripMarkdown,
    summarizeText,
    requestText,
    decodeHtmlEntities,
    unwrapDuckDuckGoUrl,
} = require("./agentShared");

// Search, prompt, and tool-planning helpers for the agent loop.

function searchMemory(service, query) {
    const needle = String(query || "").trim().toLowerCase();
    const items = service.getLongTermMemory()
        .filter((item) => item.status !== "archived")
        .filter((item) => {
            if (!needle) return true;
            const haystack = `${item.title}\n${item.content}\n${item.source || ""}\n${item.category || ""}\n${(item.tags || []).join(" ")}`.toLowerCase();
            return haystack.includes(needle);
        })
        .slice(0, 16)
        .map((item) => ({
            id: item.id,
            title: item.title,
            content: item.content,
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
    const items = service.getKnowledgeCards()
        .filter((item) => {
            if (!needle) return true;
            const haystack = `${item.title}\n${item.category}\n${item.content}`.toLowerCase();
            return haystack.includes(needle);
        })
        .slice(0, 12)
        .map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            summary: item.summary || summarizeText(item.content, 120),
            updatedAt: item.updatedAt || item.createdAt || "",
        }));
    return {items};
}

function listCards(service, category) {
    const needle = String(category || "").trim().toLowerCase();
    const items = service.getKnowledgeCards()
        .filter((item) => !needle || String(item.category || "").toLowerCase() === needle)
        .slice(0, 20)
        .map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            summary: item.summary || summarizeText(item.content, 120),
            updatedAt: item.updatedAt || item.createdAt || "",
        }));
    return {items};
}

function getCard(service, args) {
    const id = String(args?.id || "").trim();
    const title = String(args?.title || "").trim().toLowerCase();
    const card = service.getKnowledgeCards().find((item) => {
        return (id && item.id === id)
            || (title && String(item.title || "").trim().toLowerCase() === title);
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
    const text = String(userMessage || "").toLowerCase();
    const plan = [];
    if (/(最新|新闻|搜索|搜一下网页|web|news)/.test(text)) plan.push({tool: "web_search", args: {query: userMessage}});
    if (/(资料|文件|代码|markdown|pdf|仓库|项目|library|repo)/.test(text)) {
        plan.push({tool: "get_library_overview", args: {}});
        plan.push({tool: "search_library", args: {query: userMessage}});
    }
    if (/(记忆|memory|偏好|长期)/.test(text)) {
        plan.push({tool: "search_memory", args: {query: userMessage}});
        plan.push({tool: "get_memory_routine_status", args: {}});
    }
    if (/(卡片|cards|知识)/.test(text)) {
        plan.push({tool: "search_cards", args: {query: userMessage}});
        plan.push({tool: "list_cards", args: {}});
    }
    if (/(番茄钟|pomodoro|计时)/.test(text)) plan.push({tool: "get_pomodoro_status", args: {}});
    if (/(剪贴板|clipboard)/.test(text)) plan.push({tool: "get_clipboard", args: {}});
    if (/(截图|screen|屏幕)/.test(text)) plan.push({tool: "list_screenshots", args: {}});
    const seen = new Set();
    return plan.filter((item) => {
        const key = `${item.tool}:${JSON.stringify(item.args)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, 4);
}

async function runPrefetchTools(service, userMessage, traces, conversation) {
    const plan = buildPrefetchPlan(userMessage);
    for (const item of plan) {
        try {
            const result = await service.runTool(item.tool, item.args);
            traces.push({tool: item.tool, status: "success", input: item.args, outputPreview: clampTraceOutput(result), phase: "prefetch"});
            conversation.push({
                role: "user",
                content: [{type: "text", text: `Prefetched tool result for ${item.tool}: ${JSON.stringify(result)}`}],
            });
        } catch (error) {
            traces.push({
                tool: item.tool,
                status: "error",
                input: item.args,
                outputPreview: clampTraceOutput({error: error?.message || String(error)}),
                phase: "prefetch",
            });
        }
    }
}

function buildAgentSystemPrompt(memories, context) {
    const memoryText = memories.length ? memories.map((item, index) => `${index + 1}. ${item.title}: ${item.content}`).join("\n") : "No long-term memory.";
    const contextText = context.length ? context.map((item) => `${item.role}: ${summarizeText(item.message, 120)}`).join("\n") : "No recent context.";
    return [
        "You are the desktop agent orchestration layer.",
        "Use tools when needed, but always produce the final answer yourself.",
        "If calling a tool, output only one JSON object and nothing else.",
        "Tool call format: {\"type\":\"tool\",\"tool\":\"tool_name\",\"args\":{...}}",
        "Final answer format: {\"type\":\"final\",\"content\":\"reply for the user\"}",
        "Available tools:",
        "- get_context {}",
        "- get_memory {}",
        "- search_memory {\"query\":\"keyword\"}",
        "- get_memory_routine_status {}",
        "- add_memory {\"title\":\"title\",\"content\":\"content\",\"source\":\"agent\"}",
        "- delete_memory {\"id\":\"memory-id\"}",
        "- extract_memory {}",
        "- list_cards {\"category\":\"optional\"}",
        "- search_cards {\"query\":\"keyword\"}",
        "- get_card {\"id\":\"card-id\",\"title\":\"optional\"}",
        "- create_card {\"title\":\"title\",\"content\":\"content\",\"category\":\"category\",\"source\":\"agent\"}",
        "- get_pomodoro_status {}",
        "- get_clipboard {}",
        "- analyze_clipboard_image {\"prompt\":\"optional\"}",
        "- get_library_overview {}",
        "- search_library {\"query\":\"keyword\"}",
        "- read_library_file {\"path\":\"relative path or file name\"}",
        "- web_search {\"query\":\"keyword\"}",
        "- capture_screen {\"name\":\"optional name\"}",
        "- list_screenshots {}",
        "- analyze_image {\"imagePath\":\"path\",\"prompt\":\"analysis request\"}",
        "Never fabricate tool output.",
        "If a task cannot be completed, say so clearly.",
        "Recent context:",
        contextText,
        "Long-term memory:",
        memoryText,
    ].join("\n");
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
    case "capture_screen": return service.captureScreen(args?.name);
    case "list_screenshots": return service.listScreenshots();
    case "analyze_image": return service.analyzeImage(args);
    default: throw new Error(`Unknown tool: ${toolName}`);
    }
}

async function webSearch(service, query) {
    const value = String(query || "").trim();
    if (!value) throw new Error("Search query is required.");
    const attempts = [
        {
            name: "bing-rss",
            url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(value)}`,
            parse(xml) {
                const results = [];
                const pattern = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi;
                let match;
                while ((match = pattern.exec(xml)) && results.length < 8) {
                    results.push({title: stripMarkdown(decodeHtmlEntities(match[1])), url: decodeHtmlEntities(match[2].trim())});
                }
                return results;
            },
        },
        {
            name: "bing",
            url: `https://www.bing.com/search?q=${encodeURIComponent(value)}`,
            parse(html) {
                const results = [];
                const pattern = /<li class="b_algo"[\s\S]*?<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi;
                let match;
                while ((match = pattern.exec(html)) && results.length < 8) {
                    results.push({title: stripMarkdown(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))), url: decodeHtmlEntities(match[1])});
                }
                return results;
            },
        },
        {
            name: "duckduckgo",
            url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(value)}`,
            parse(html) {
                const results = [];
                const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
                let match;
                while ((match = pattern.exec(html)) && results.length < 8) {
                    results.push({title: stripMarkdown(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))), url: unwrapDuckDuckGoUrl(decodeHtmlEntities(match[1]))});
                }
                return results;
            },
        },
    ];
    let lastError = "";
    for (const attempt of attempts) {
        try {
            const html = await requestText(attempt.url, {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            });
            const results = attempt.parse(html).filter((item) => item.title && item.url);
            if (results.length) return {query: value, provider: attempt.name, results};
            lastError = `${attempt.name} returned no parsable results`;
        } catch (error) {
            lastError = error?.message || String(error);
        }
    }
    return {query: value, provider: "unavailable", results: [], error: lastError || "Web search is temporarily unavailable."};
}

module.exports = {searchMemory, searchCards, listCards, getCard, parseAgentResponse, buildPrefetchPlan, runPrefetchTools, buildAgentSystemPrompt, runTool, webSearch};
