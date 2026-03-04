const {ENV_CONFIG} = require("../config");

function buildBigModelRequestBody(message, options = {}, stream = false) {
    const temperature = options.temperature ?? 0;
    const maxTokens = options.maxTokens ?? 65536;
    const thinkingType = options.enableThinking ? "enabled" : "disabled";
    return {
        model: options.model || ENV_CONFIG.AI_MODEL,
        messages: message.map((item) => ({
            role: item.role,
            content: Array.isArray(item.content)
                ? item.content
                : (item.message ?? item.content ?? ""),
        })),
        stream,
        do_sample: false,
        temperature,
        max_tokens: maxTokens,
        thinking: {
            type: thinkingType,
            clear_thinking: true,
        },
    };
}

function buildBigModelRequestOptions(message, options = {}, stream = false) {
    const model = options.model || ENV_CONFIG.AI_MODEL;
    const baseUrl = ENV_CONFIG.BASE_URL;
    const apiKey = ENV_CONFIG.API_KEY;

    if (!apiKey) {
        throw new Error("Missing API_KEY environment variable");
    }
    if (!model) {
        throw new Error("Missing AI model configuration");
    }

    const url = baseUrl.replace(/\/$/, "") + "/api/paas/v4/chat/completions";
    const body = buildBigModelRequestBody(message, options, stream);
    return {url, body, apiKey, model};
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

async function chatCompletionsBigModel(message, options = {}) {
    const {url, body, apiKey, model} = buildBigModelRequestOptions(message, options, false);

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
        throw new Error(`BigModel fetch failed url=${url} model=${model} reason=${error?.message || error}`);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`BigModel request failed status=${response.status} body=${text}`);
    }

    return await response.json();
}

async function chatCompletionsBigModelStream(message, options = {}, handlers = {}) {
    const {url, body, apiKey, model} = buildBigModelRequestOptions(message, options, true);

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
        throw new Error(`BigModel stream fetch failed url=${url} model=${model} reason=${error?.message || error}`);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`BigModel stream request failed status=${response.status} body=${text}`);
    }

    if (!response.body) {
        throw new Error("BigModel stream response body is unavailable");
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
        return chatCompletionsBigModel(message, options);
    },
    aiChatWithContent(message, options) {
        return chatCompletionsBigModel(message, options);
    },
    aiChatWithModel(message, options) {
        return chatCompletionsBigModel(message, options);
    },
    aiChatStream(message, options, handlers) {
        return chatCompletionsBigModelStream(message, options, handlers);
    },
    aiChatWithContentStream(message, options, handlers) {
        return chatCompletionsBigModelStream(message, options, handlers);
    },
    aiChatWithModelStream(message, options, handlers) {
        return chatCompletionsBigModelStream(message, options, handlers);
    },
};
