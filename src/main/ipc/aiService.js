async function chatCompletionsBigModel(message, options = {}) {
    require("dotenv").config();

    const model = options.model || process.env.AI_MODEL;
    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.API_KEY;
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
        messages: message.map((item) => ({role: item.role, content: item.message})),
        stream: false,
        do_sample: false,
        temperature,
        max_tokens: maxTokens,
        thinking: {
            type: "disabled",
            clear_thinking: true,
        },
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

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
    aiChatWithModel(message, options) {
        return chatCompletionsBigModel(message, options);
    },
};
