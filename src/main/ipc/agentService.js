const fs = require("fs/promises");
const path = require("path");
const http = require("http");
const https = require("https");
const {
    clipboard,
    desktopCapturer,
} = require("electron");
const {aiChatWithContent, aiChatWithModel} = require("./aiService");
const {
    AGENT_LIBRARY_INDEX_JSON_PATH,
    AGENT_LIBRARY_ROOTS_JSON_PATH,
    AGENT_SCREENSHOT_DIR_PATH,
    PROJECT_ROOT,
} = require("../config");

const MAX_AGENT_STEPS = 6;
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_FILE_RESULT_CHARS = 12000;
const DEFAULT_LIBRARY_ROOTS = [PROJECT_ROOT];
const INDEXABLE_EXTENSIONS = new Set([
    ".md", ".markdown", ".txt", ".json", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss", ".less",
    ".html", ".htm", ".xml", ".yml", ".yaml", ".toml", ".ini", ".py", ".java", ".c", ".cpp", ".h",
    ".hpp", ".rs", ".go", ".php", ".rb", ".sql", ".sh", ".ps1", ".bat", ".env", ".pdf",
]);
const TEXT_EXTENSIONS = new Set([...INDEXABLE_EXTENSIONS].filter((ext) => ext !== ".pdf"));
const IGNORED_DIRS = new Set([".git", "node_modules", "out", ".idea", "dist", "build"]);

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

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

class AgentService {
    constructor(options) {
        this.getAssistantContext = options.getAssistantContext;
        this.getLongTermMemory = options.getLongTermMemory;
        this.addLongTermMemory = options.addLongTermMemory;
        this.deleteLongTermMemory = options.deleteLongTermMemory;
        this.extractLongTermMemories = options.extractLongTermMemories;
        this.getKnowledgeCards = options.getKnowledgeCards;
        this.createKnowledgeCard = options.createKnowledgeCard;
        this.getPomodoroData = options.getPomodoroData;
        this.libraryRoots = [];
        this.libraryIndex = {updatedAt: "", items: []};
    }

    async ensureReady() {
        await fs.mkdir(AGENT_SCREENSHOT_DIR_PATH, {recursive: true});
        this.libraryRoots = await this.loadLibraryRoots();
        await this.rebuildLibraryIndex();
    }

    async loadLibraryRoots() {
        try {
            const raw = await fs.readFile(AGENT_LIBRARY_ROOTS_JSON_PATH, "utf8");
            const data = safeJsonParse(raw);
            if (Array.isArray(data?.roots) && data.roots.length) {
                return data.roots
                    .filter((item) => typeof item === "string" && item.trim())
                    .map((item) => path.resolve(item));
            }
        } catch (error) {
            if (error?.code !== "ENOENT") {
                console.warn("[agent] loadLibraryRoots failed:", error.message);
            }
        }
        const roots = DEFAULT_LIBRARY_ROOTS.map((item) => path.resolve(item));
        await fs.writeFile(AGENT_LIBRARY_ROOTS_JSON_PATH, JSON.stringify({roots}, null, 2), "utf8");
        return roots;
    }

    async rebuildLibraryIndex() {
        const items = [];
        for (const root of this.libraryRoots) {
            await this.walkLibraryRoot(root, items);
        }
        this.libraryIndex = {
            updatedAt: isoNow(),
            items,
        };
        await fs.writeFile(AGENT_LIBRARY_INDEX_JSON_PATH, JSON.stringify(this.libraryIndex, null, 2), "utf8");
    }

    async walkLibraryRoot(root, items, currentDir = root) {
        let entries = [];
        try {
            entries = await fs.readdir(currentDir, {withFileTypes: true});
        } catch (error) {
            console.warn("[agent] walkLibraryRoot failed:", currentDir, error.message);
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name)) {
                    continue;
                }
                await this.walkLibraryRoot(root, items, fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!INDEXABLE_EXTENSIONS.has(ext)) {
                continue;
            }
            try {
                const stat = await fs.stat(fullPath);
                if (stat.size > MAX_FILE_SIZE) {
                    items.push(this.buildLibraryItem(root, fullPath, stat, ext, "", "oversize"));
                    continue;
                }
                let excerpt = "";
                if (TEXT_EXTENSIONS.has(ext)) {
                    const content = await fs.readFile(fullPath, "utf8");
                    excerpt = summarizeText(content, 320);
                } else if (ext === ".pdf") {
                    excerpt = "PDF document indexed by filename and metadata only.";
                }
                items.push(this.buildLibraryItem(root, fullPath, stat, ext, excerpt, "ready"));
            } catch (error) {
                items.push(this.buildLibraryItem(root, fullPath, null, ext, error.message, "error"));
            }
        }
    }

    buildLibraryItem(root, fullPath, stat, ext, excerpt, status) {
        const relativePath = path.relative(root, fullPath);
        return {
            id: `${root}::${relativePath}`.replace(/\\/g, "/"),
            root,
            relativePath: relativePath.replace(/\\/g, "/"),
            fullPath,
            name: path.basename(fullPath),
            ext,
            excerpt,
            status,
            size: stat?.size ?? 0,
            mtimeMs: stat?.mtimeMs ?? 0,
        };
    }

    getCapabilities() {
        return {
            visionEnabled: Boolean(process.env.AI_VISION_MODEL || process.env.VISION_MODEL),
            libraryRootCount: this.libraryRoots.length,
            libraryFileCount: this.libraryIndex.items.length,
            libraryUpdatedAt: this.libraryIndex.updatedAt,
            tools: [
                "get_context",
                "get_memory",
                "add_memory",
                "delete_memory",
                "extract_memory",
                "list_cards",
                "search_cards",
                "get_card",
                "create_card",
                "get_pomodoro_status",
                "get_clipboard",
                "analyze_clipboard_image",
                "get_library_overview",
                "search_library",
                "read_library_file",
                "web_search",
                "capture_screen",
                "list_screenshots",
                "analyze_image",
            ],
        };
    }

    getLibraryIndexData() {
        return {
            updatedAt: this.libraryIndex.updatedAt,
            rootCount: this.libraryRoots.length,
            items: this.libraryIndex.items.map((item) => ({
                id: item.id,
                root: item.root,
                relativePath: item.relativePath,
                fullPath: item.fullPath,
                name: item.name,
                ext: item.ext,
                excerpt: item.excerpt,
                status: item.status,
                size: item.size,
                mtimeMs: item.mtimeMs,
            })),
        };
    }

    async chat(userMessage) {
        const traces = [];
        const conversation = [];
        const context = this.getAssistantContext().slice(-8);
        const memories = this.getLongTermMemory().slice(-10).map((item) => ({
            title: item.title,
            content: summarizeText(item.content, 160),
        }));

        conversation.push({
            role: "system",
            content: [
                {
                    type: "text",
                    text: this.buildAgentSystemPrompt(memories, context),
                },
            ],
        });
        conversation.push({
            role: "user",
            content: [{type: "text", text: userMessage}],
        });

        for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
            const response = await aiChatWithContent(conversation, {
                temperature: 0.2,
                maxTokens: 2048,
            });
            const content = response?.choices?.[0]?.message?.content ?? "";
            const action = this.parseAgentResponse(content);
            if (!action) {
                return {
                    mode: "agent",
                    content: content || "我暂时没有得到可用结果。",
                    traces,
                };
            }
            if (action.type === "final") {
                return {
                    mode: "agent",
                    content: action.content || content || "我暂时没有得到可用结果。",
                    traces,
                };
            }
            if (action.type !== "tool") {
                return {
                    mode: "agent",
                    content: content || "工具流程没有返回可用结果。",
                    traces,
                };
            }

            const args = normalizeToolArgs(action.args);
            let toolResult;
            try {
                toolResult = await this.runTool(action.tool, args);
                traces.push({
                    tool: action.tool,
                    status: "success",
                    input: args,
                    outputPreview: clampTraceOutput(toolResult),
                });
            } catch (error) {
                toolResult = {
                    error: error?.message || String(error),
                };
                traces.push({
                    tool: action.tool,
                    status: "error",
                    input: args,
                    outputPreview: clampTraceOutput(toolResult),
                });
            }

            conversation.push({
                role: "assistant",
                content: [{type: "text", text: JSON.stringify(action)}],
            });
            conversation.push({
                role: "user",
                content: [{
                    type: "text",
                    text: `Tool result for ${action.tool}: ${JSON.stringify(toolResult)}`,
                }],
            });
        }

        return {
            mode: "agent",
            content: "工具调用达到上限，我先停在这里。你可以让我继续细化其中一个方向。",
            traces,
        };
    }

    buildAgentSystemPrompt(memories, context) {
        const memoryText = memories.length
            ? memories.map((item, index) => `${index + 1}. ${item.title}: ${item.content}`).join("\n")
            : "暂无长期记忆。";
        const contextText = context.length
            ? context.map((item) => `${item.role}: ${summarizeText(item.message, 120)}`).join("\n")
            : "暂无最近上下文。";
        const toolSpec = [
            "你现在是桌宠主模型的 agent 编排层。你可以自己决定是否调用工具，但最终答复必须由你生成。",
            "如果需要调用工具，只能输出一个 JSON 对象，不要输出额外文本。",
            "工具调用格式：{\"type\":\"tool\",\"tool\":\"工具名\",\"args\":{...}}",
            "最终回答格式：{\"type\":\"final\",\"content\":\"给用户的最终回复\"}",
            "可用工具：",
            "- get_context {}",
            "- get_memory {}",
            "- add_memory {\"title\":\"标题\",\"content\":\"内容\",\"source\":\"agent\"}",
            "- search_cards {\"query\":\"关键词\"}",
            "- create_card {\"title\":\"标题\",\"content\":\"内容\",\"category\":\"分类\",\"source\":\"agent\"}",
            "- get_pomodoro_status {}",
            "- get_clipboard {}",
            "- search_library {\"query\":\"关键词\"}",
            "- read_library_file {\"path\":\"相对路径或文件名\"}",
            "- web_search {\"query\":\"关键词\"}",
            "- capture_screen {\"name\":\"可选名称\"}",
            "- analyze_image {\"imagePath\":\"路径\",\"prompt\":\"分析要求\"}",
            "调用工具前先判断是否真的需要。能直接回答就直接回答。",
            "不要伪造工具结果。无法完成时要诚实说明。",
            "最近上下文：",
            contextText,
            "长期记忆：",
            memoryText,
        ];
        return toolSpec.join("\n");
    }

    parseAgentResponse(content) {
        const text = String(content || "").trim();
        const direct = safeJsonParse(text);
        if (direct) {
            return direct;
        }
        const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
        if (match) {
            return safeJsonParse(match[1].trim());
        }
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            return safeJsonParse(text.slice(firstBrace, lastBrace + 1));
        }
        return null;
    }

    async runTool(toolName, args) {
        switch (toolName) {
        case "get_context":
            return {
                items: this.getAssistantContext().slice(-16),
            };
        case "get_memory":
            return {
                items: this.getLongTermMemory(),
            };
        case "add_memory":
            return await this.addLongTermMemory(args);
        case "search_cards":
            return this.searchCards(args.query);
        case "create_card":
            return await this.createKnowledgeCard(args);
        case "get_pomodoro_status":
            return await this.getPomodoroStatus();
        case "get_clipboard":
            return this.getClipboardSnapshot();
        case "search_library":
            return this.searchLibrary(args.query);
        case "read_library_file":
            return await this.readLibraryFile(args.path);
        case "web_search":
            return await this.webSearch(args.query);
        case "capture_screen":
            return await this.captureScreen(args.name);
        case "analyze_image":
            return await this.analyzeImage(args);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    searchCards(query) {
        const needle = String(query || "").trim().toLowerCase();
        const items = this.getKnowledgeCards()
            .filter((item) => {
                if (!needle) {
                    return true;
                }
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

    async getPomodoroStatus() {
        const tasks = await this.getPomodoroData();
        return {
            taskCount: tasks.length,
            tasks: tasks.slice(0, 12).map((item) => ({
                id: item.id,
                title: item.title,
                workMinutes: Math.round((Number(item.workTime) || 0) / 60000),
                restMinutes: Math.round((Number(item.restTime) || 0) / 60000),
                repeatTimes: Number(item.repeatTimes) || 0,
            })),
        };
    }

    getClipboardSnapshot() {
        const text = clipboard.readText();
        const image = clipboard.readImage();
        const size = image?.isEmpty?.() ? {width: 0, height: 0} : image.getSize();
        return {
            hasText: Boolean(text),
            text: text ? text.slice(0, 4000) : "",
            hasImage: !image.isEmpty(),
            imageWidth: size.width || 0,
            imageHeight: size.height || 0,
        };
    }

    searchLibrary(query) {
        const needle = String(query || "").trim().toLowerCase();
        const items = this.libraryIndex.items
            .filter((item) => {
                if (!needle) {
                    return true;
                }
                const haystack = `${item.relativePath}\n${item.name}\n${item.excerpt}`.toLowerCase();
                return haystack.includes(needle);
            })
            .sort((a, b) => {
                const aName = a.relativePath.toLowerCase();
                const bName = b.relativePath.toLowerCase();
                const aHit = aName.includes(needle) ? 1 : 0;
                const bHit = bName.includes(needle) ? 1 : 0;
                if (aHit !== bHit) {
                    return bHit - aHit;
                }
                return b.mtimeMs - a.mtimeMs;
            })
            .slice(0, 16)
            .map((item) => ({
                path: item.relativePath,
                ext: item.ext,
                status: item.status,
                excerpt: item.excerpt,
            }));
        return {
            updatedAt: this.libraryIndex.updatedAt,
            items,
        };
    }

    async readLibraryFile(requestedPath) {
        const value = String(requestedPath || "").trim().replace(/\\/g, "/");
        if (!value) {
            throw new Error("File path is required.");
        }
        const candidates = this.libraryIndex.items.filter((item) => {
            return item.relativePath === value
                || item.name === value
                || item.relativePath.toLowerCase() === value.toLowerCase()
                || item.name.toLowerCase() === value.toLowerCase();
        });
        const file = candidates[0];
        if (!file) {
            const fuzzy = this.libraryIndex.items.find((item) => item.relativePath.toLowerCase().includes(value.toLowerCase()));
            if (!fuzzy) {
                throw new Error(`File not found: ${value}`);
            }
            return this.readLibraryFile(fuzzy.relativePath);
        }
        if (file.ext === ".pdf") {
            return {
                path: file.relativePath,
                fullPath: file.fullPath,
                ext: file.ext,
                mode: "pdf",
                content: "当前版本只索引 PDF 元数据，后续资料库视图再接入真正的 PDF 阅读。",
            };
        }
        if (!TEXT_EXTENSIONS.has(file.ext)) {
            return {
                path: file.relativePath,
                fullPath: file.fullPath,
                ext: file.ext,
                mode: "binary",
                content: "Binary file preview is not supported.",
            };
        }
        const content = await fs.readFile(file.fullPath, "utf8");
        return {
            path: file.relativePath,
            fullPath: file.fullPath,
            ext: file.ext,
            mode: "text",
            content: content.length > MAX_FILE_RESULT_CHARS ? `${content.slice(0, MAX_FILE_RESULT_CHARS)}\n...` : content,
        };
    }

    async webSearch(query) {
        const value = String(query || "").trim();
        if (!value) {
            throw new Error("Search query is required.");
        }
        const url = `https://duckduckgo.com/?q=${encodeURIComponent(value)}&ia=web`;
        const html = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
            },
        }).then(async (response) => {
            if (!response.ok) {
                throw new Error(`Web search failed with status ${response.status}`);
            }
            return response.text();
        });
        const results = [];
        const pattern = /<a[^>]*data-testid="result-title-a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = pattern.exec(html)) && results.length < 8) {
            const title = stripMarkdown(match[2].replace(/<[^>]+>/g, " "));
            const href = match[1];
            results.push({title, url: href});
        }
        return {
            query: value,
            results,
        };
    }

    async captureScreen(name) {
        const sources = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: {width: 1920, height: 1080},
            fetchWindowIcons: false,
        });
        if (!sources.length) {
            throw new Error("No screen source available.");
        }
        const source = sources[0];
        const image = source.thumbnail;
        if (!image || image.isEmpty()) {
            throw new Error("Capture failed.");
        }
        const safeName = sanitizeFileName(name || source.name || "screen");
        const filePath = path.join(AGENT_SCREENSHOT_DIR_PATH, `${Date.now()}-${safeName}.png`);
        await fs.writeFile(filePath, image.toPNG());
        return {
            name: source.name,
            imagePath: filePath,
            width: image.getSize().width,
            height: image.getSize().height,
        };
    }

    async analyzeImage(args) {
        const imagePath = String(args?.imagePath || "").trim();
        const prompt = String(args?.prompt || "请概括图片中的关键信息。").trim();
        if (!imagePath) {
            throw new Error("imagePath is required.");
        }
        const model = process.env.AI_VISION_MODEL || process.env.VISION_MODEL;
        if (!model) {
            throw new Error("Missing vision model configuration.");
        }
        const buffer = await fs.readFile(imagePath);
        const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
        const response = await aiChatWithModel([
            {
                role: "system",
                content: [
                    {
                        type: "text",
                        text: "你是图像分析工具，只返回客观、简洁的中文观察结果。",
                    },
                ],
            },
            {
                role: "user",
                content: [
                    {type: "text", text: prompt},
                    {type: "image_url", image_url: {url: dataUrl}},
                ],
            },
        ], {
            model,
            temperature: 0.1,
            maxTokens: 512,
        });
        return {
            imagePath,
            analysis: response?.choices?.[0]?.message?.content ?? "",
        };
    }

    listCards(category) {
        const needle = String(category || "").trim().toLowerCase();
        const items = this.getKnowledgeCards()
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

    getCard(args) {
        const id = String(args?.id || "").trim();
        const title = String(args?.title || "").trim().toLowerCase();
        const card = this.getKnowledgeCards().find((item) => {
            return (id && item.id === id)
                || (title && String(item.title || "").trim().toLowerCase() === title);
        });
        if (!card) {
            throw new Error("Card not found.");
        }
        return card;
    }

    searchMemory(query) {
        const needle = String(query || "").trim().toLowerCase();
        const items = this.getLongTermMemory()
            .filter((item) => {
                if (!needle) {
                    return true;
                }
                const haystack = `${item.title}\n${item.content}\n${item.source || ""}`.toLowerCase();
                return haystack.includes(needle);
            })
            .slice(0, 16)
            .map((item) => ({
                id: item.id,
                title: item.title,
                content: item.content,
                source: item.source || "manual",
                updatedAt: item.updatedAt || "",
            }));
        return {items};
    }

    getLibraryOverview() {
        const recentFiles = [...this.libraryIndex.items]
            .sort((a, b) => b.mtimeMs - a.mtimeMs)
            .slice(0, 10)
            .map((item) => ({
                path: item.relativePath,
                ext: item.ext,
                updatedAt: item.mtimeMs ? new Date(item.mtimeMs).toISOString() : "",
                excerpt: item.excerpt,
            }));
        return {
            updatedAt: this.libraryIndex.updatedAt,
            rootCount: this.libraryRoots.length,
            fileCount: this.libraryIndex.items.length,
            recentFiles,
        };
    }

    async listScreenshots() {
        const entries = await fs.readdir(AGENT_SCREENSHOT_DIR_PATH, {withFileTypes: true}).catch(() => []);
        const files = [];
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const fullPath = path.join(AGENT_SCREENSHOT_DIR_PATH, entry.name);
            const stat = await fs.stat(fullPath).catch(() => null);
            files.push({
                name: entry.name,
                imagePath: fullPath,
                updatedAt: stat?.mtime?.toISOString?.() || "",
                size: stat?.size || 0,
            });
        }
        files.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        return {items: files.slice(0, 20)};
    }

    async analyzeClipboardImage(args = {}) {
        const image = clipboard.readImage();
        if (!image || image.isEmpty()) {
            throw new Error("Clipboard image is empty.");
        }
        const filePath = path.join(AGENT_SCREENSHOT_DIR_PATH, `${Date.now()}-clipboard.png`);
        await fs.writeFile(filePath, image.toPNG());
        return await this.analyzeImage({
            imagePath: filePath,
            prompt: args.prompt || "Analyze the clipboard image.",
        });
    }

    getCapabilities() {
        return {
            visionEnabled: Boolean(process.env.AI_VISION_MODEL || process.env.VISION_MODEL),
            libraryRootCount: this.libraryRoots.length,
            libraryFileCount: this.libraryIndex.items.length,
            libraryUpdatedAt: this.libraryIndex.updatedAt,
            tools: [
                "get_context",
                "get_memory",
                "search_memory",
                "add_memory",
                "delete_memory",
                "extract_memory",
                "list_cards",
                "search_cards",
                "get_card",
                "create_card",
                "get_pomodoro_status",
                "get_clipboard",
                "analyze_clipboard_image",
                "get_library_overview",
                "search_library",
                "read_library_file",
                "web_search",
                "capture_screen",
                "list_screenshots",
                "analyze_image",
            ],
        };
    }

    buildAgentSystemPrompt(memories, context) {
        const memoryText = memories.length
            ? memories.map((item, index) => `${index + 1}. ${item.title}: ${item.content}`).join("\n")
            : "No long-term memory.";
        const contextText = context.length
            ? context.map((item) => `${item.role}: ${summarizeText(item.message, 120)}`).join("\n")
            : "No recent context.";
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

    async runTool(toolName, args) {
        switch (toolName) {
        case "get_context":
            return {items: this.getAssistantContext().slice(-16)};
        case "get_memory":
            return {items: this.getLongTermMemory()};
        case "search_memory":
            return this.searchMemory(args?.query);
        case "add_memory":
            return await this.addLongTermMemory(args);
        case "delete_memory":
            return await this.deleteLongTermMemory(args?.id);
        case "extract_memory":
            return await this.extractLongTermMemories();
        case "list_cards":
            return this.listCards(args?.category);
        case "search_cards":
            return this.searchCards(args.query);
        case "get_card":
            return this.getCard(args);
        case "create_card":
            return await this.createKnowledgeCard(args);
        case "get_pomodoro_status":
            return await this.getPomodoroStatus();
        case "get_clipboard":
            return this.getClipboardSnapshot();
        case "analyze_clipboard_image":
            return await this.analyzeClipboardImage(args);
        case "get_library_overview":
            return this.getLibraryOverview();
        case "search_library":
            return this.searchLibrary(args.query);
        case "read_library_file":
            return await this.readLibraryFile(args.path);
        case "web_search":
            return await this.webSearch(args.query);
        case "capture_screen":
            return await this.captureScreen(args.name);
        case "list_screenshots":
            return await this.listScreenshots();
        case "analyze_image":
            return await this.analyzeImage(args);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    async readLibraryFile(requestedPath) {
        const value = String(requestedPath || "").trim().replace(/\\/g, "/");
        if (!value) {
            throw new Error("File path is required.");
        }
        const candidates = this.libraryIndex.items.filter((item) => {
            return item.relativePath === value
                || item.name === value
                || item.relativePath.toLowerCase() === value.toLowerCase()
                || item.name.toLowerCase() === value.toLowerCase();
        });
        const file = candidates[0]
            || this.libraryIndex.items.find((item) => item.relativePath.toLowerCase().includes(value.toLowerCase()));
        if (!file) {
            throw new Error(`File not found: ${value}`);
        }
        if (file.ext === ".pdf") {
            return {
                path: file.relativePath,
                fullPath: file.fullPath,
                ext: file.ext,
                mode: "pdf",
                content: "",
            };
        }
        if (!TEXT_EXTENSIONS.has(file.ext)) {
            return {
                path: file.relativePath,
                fullPath: file.fullPath,
                ext: file.ext,
                mode: "binary",
                content: "Binary file preview is not supported.",
            };
        }
        const content = await fs.readFile(file.fullPath, "utf8");
        return {
            path: file.relativePath,
            fullPath: file.fullPath,
            ext: file.ext,
            mode: "text",
            content: content.length > MAX_FILE_RESULT_CHARS ? `${content.slice(0, MAX_FILE_RESULT_CHARS)}\n...` : content,
        };
    }

    async webSearch(query) {
        const value = String(query || "").trim();
        if (!value) {
            throw new Error("Search query is required.");
        }
        const attempts = [
            {
                name: "bing-rss",
                url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(value)}`,
                parse(xml) {
                    const results = [];
                    const pattern = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi;
                    let match;
                    while ((match = pattern.exec(xml)) && results.length < 8) {
                        results.push({
                            title: stripMarkdown(decodeHtmlEntities(match[1])),
                            url: decodeHtmlEntities(match[2].trim()),
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
                    const pattern = /<li class="b_algo"[\s\S]*?<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi;
                    let match;
                    while ((match = pattern.exec(html)) && results.length < 8) {
                        results.push({
                            title: stripMarkdown(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))),
                            url: decodeHtmlEntities(match[1]),
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
                    const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
                    let match;
                    while ((match = pattern.exec(html)) && results.length < 8) {
                        results.push({
                            title: stripMarkdown(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))),
                            url: unwrapDuckDuckGoUrl(decodeHtmlEntities(match[1])),
                        });
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
                if (results.length) {
                    return {query: value, provider: attempt.name, results};
                }
                lastError = `${attempt.name} returned no parsable results`;
            } catch (error) {
                lastError = error?.message || String(error);
            }
        }

        return {
            query: value,
            provider: "unavailable",
            results: [],
            error: lastError || "Web search is temporarily unavailable.",
        };
    }
}

module.exports = {
    AgentService,
};
