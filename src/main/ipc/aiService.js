const {ENV_CONFIG} = require("../config");

function normalizeMessageContent(item = {}) {
    if (Array.isArray(item.content)) {
        return item.content;
    }
    return item.message ?? item.content ?? "";
}

function normalizeApiPath(apiPath = "") {
    const raw = String(apiPath || "").trim();
    if (!raw) {
        return "/chat/completions";
    }
    return raw.startsWith("/") ? raw : `/${raw}`;
}

function joinUrl(baseUrl, apiPath) {
    const normalizedBase = String(baseUrl || "").trim().replace(/\/+$/, "");
    return `${normalizedBase}${normalizeApiPath(apiPath)}`;
}

function resolveProviderRuntime(options = {}) {
    const providerId = String(options.providerId || ENV_CONFIG.AI_PROVIDER || "").trim().toLowerCase();
    const requestFormatRaw = String(options.requestFormat || ENV_CONFIG.AI_REQUEST_FORMAT || "").trim().toLowerCase();
    const requestFormat = requestFormatRaw || (providerId === "zhipu" ? "zhipu" : "openai");

    return {
        providerId,
        requestFormat,
        baseUrl: options.baseUrl || ENV_CONFIG.BASE_URL,
        apiPath: options.apiPath || ENV_CONFIG.AI_API_PATH || "/chat/completions",
        apiKey: options.apiKey || ENV_CONFIG.API_KEY,
        model: options.model || ENV_CONFIG.AI_MODEL,
    };
}

function buildChatRequestBody(message, runtime, options = {}, stream = false) {
    const basePayload = {
        model: runtime.model,
        messages: message.map((item) => ({
            role: item.role,
            content: normalizeMessageContent(item),
        })),
        stream,
    };
    if (options.temperature != null) {
        basePayload.temperature = options.temperature;
    }
    if (options.maxTokens != null) {
        basePayload.max_tokens = options.maxTokens;
    }

    const isMoonshotK25 = runtime.providerId === "moonshot"
        && /^kimi-k2\.5($|[-_])/i.test(String(runtime.model || "").trim());
    if (isMoonshotK25) {
        // Moonshot official constraint:
        // thinking enabled => temperature must be 1.0
        // thinking disabled => temperature must be 0.6
        // omit temperature/thinking to use service defaults.
        if (typeof options.enableThinking === "boolean") {
            basePayload.thinking = {
                type: options.enableThinking ? "enabled" : "disabled",
            };
            basePayload.temperature = options.enableThinking ? 1 : 0.6;
        } else if ("temperature" in basePayload) {
            delete basePayload.temperature;
        }
    }

    if (runtime.requestFormat === "zhipu") {
        return {
            ...basePayload,
            do_sample: false,
            thinking: {
                type: options.enableThinking ? "enabled" : "disabled",
                clear_thinking: true,
            },
        };
    }

    return basePayload;
}

function buildChatRequestOptions(message, options = {}, stream = false) {
    const runtime = resolveProviderRuntime(options);
    const model = runtime.model;
    const baseUrl = runtime.baseUrl;
    const apiKey = runtime.apiKey;

    if (!apiKey) {
        throw new Error("Missing API_KEY environment variable");
    }
    if (!model) {
        throw new Error("Missing AI model configuration");
    }
    if (!baseUrl) {
        throw new Error("Missing BASE_URL environment variable");
    }

    const url = joinUrl(baseUrl, runtime.apiPath);
    const body = buildChatRequestBody(message, runtime, options, stream);
    return {url, body, apiKey, model, providerId: runtime.providerId, requestFormat: runtime.requestFormat};
}

function extractStreamText(payload) {
    const choice = payload?.choices?.[0];
    const candidates = [
        choice?.delta?.content,
        choice?.message?.content,
        payload?.delta?.content,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate) {
            return candidate;
        }
        if (Array.isArray(candidate)) {
            const text = candidate.map((item) => {
                if (typeof item === "string") return item;
                if (item?.type === "text" && typeof item.text === "string") return item.text;
                if (typeof item?.text === "string") return item.text;
                return "";
            }).join("");
            if (text) {
                return text;
            }
        }
    }
    return "";
}

async function chatCompletions(message, options = {}) {
    const {url, body, apiKey, model, providerId} = buildChatRequestOptions(message, options, false);

    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            signal: options.signal,
            body: JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(`AI fetch failed provider=${providerId || "unknown"} url=${url} model=${model} reason=${error?.message || error}`);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`AI request failed provider=${providerId || "unknown"} status=${response.status} body=${text}`);
    }

    return await response.json();
}

async function chatCompletionsStream(message, options = {}, handlers = {}) {
    const {url, body, apiKey, model, providerId} = buildChatRequestOptions(message, options, true);

    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            signal: options.signal,
            body: JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(`AI stream fetch failed provider=${providerId || "unknown"} url=${url} model=${model} reason=${error?.message || error}`);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`AI stream request failed provider=${providerId || "unknown"} status=${response.status} body=${text}`);
    }

    if (!response.body) {
        throw new Error("AI stream response body is unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let content = "";

    const handleEventBlock = async (block) => {
        const lines = block
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .filter(Boolean);
        for (const line of lines) {
            if (line === "[DONE]") {
                continue;
            }
            let payload;
            try {
                payload = JSON.parse(line);
            } catch (error) {
                continue;
            }
            const chunkText = extractStreamText(payload);
            if (!chunkText) {
                continue;
            }
            content += chunkText;
            if (handlers.onChunk) {
                await handlers.onChunk({
                    text: chunkText,
                    content,
                    payload,
                });
            }
        }
    };

    while (true) {
        const {value, done} = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || "";
        for (const part of parts) {
            await handleEventBlock(part);
        }
        if (done) {
            break;
        }
    }

    if (buffer.trim()) {
        await handleEventBlock(buffer);
    }

    return {
        choices: [
            {
                message: {
                    content,
                },
            },
        ],
    };
}

module.exports = {
    aiChat(message, options) {
        return chatCompletions(message, options);
    },
    aiChatWithContent(message, options) {
        return chatCompletions(message, options);
    },
    aiChatWithModel(message, options) {
        return chatCompletions(message, options);
    },
    aiChatStream(message, options, handlers) {
        return chatCompletionsStream(message, options, handlers);
    },
    aiChatWithContentStream(message, options, handlers) {
        return chatCompletionsStream(message, options, handlers);
    },
    aiChatWithModelStream(message, options, handlers) {
        return chatCompletionsStream(message, options, handlers);
    },
};
