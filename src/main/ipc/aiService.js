const {ENV_CONFIG} = require("../config");

async function chatCompletionsBigModel(message, options = {}) {
    const model = options.model || ENV_CONFIG.AI_MODEL;
    const baseUrl = ENV_CONFIG.BASE_URL;
    const apiKey = ENV_CONFIG.API_KEY;
    const temperature = options.temperature ?? 0;
    const maxTokens = options.maxTokens ?? 65536;

    if (!apiKey) {
        throw new Error("Missing API_KEY environment variable");
    }
    if (!model) {
        throw new Error("Missing AI model configuration");
    }

    const url = baseUrl.replace(/\/$/, "") + "/api/paas/v4/chat/completions";
    const body = {
        model,
        messages: message.map((item) => ({
            role: item.role,
            content: Array.isArray(item.content)
                ? item.content
                : (item.message ?? item.content ?? ""),
        })),
        stream: false,
        do_sample: false,
        temperature,
        max_tokens: maxTokens,
        thinking: {
            type: "disabled",
            clear_thinking: true,
        },
    };

    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
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
};
