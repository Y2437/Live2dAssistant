
async function chatCompletionsBigModel(message, temperature = 0, maxTokens =65536) {
    require('dotenv').config();
    const model=process.env.AI_MODEL;
    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        throw new Error("缺少环境变量 API_KEY");
    }
    const url = baseUrl.replace(/\/$/, "") + "/api/paas/v4/chat/completions";
    const body = {
        model,
        messages: message.map(m=>({role:m.role,content:m.message})),
        stream: false,
        do_sample: false,
        temperature,
        max_tokens: maxTokens,
        thinking: {
            type: "disabled",
            clear_thinking: true,
        },
    };
    const r = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const text = await r.text();
        throw new Error(`BigModel请求失败 status=${r.status} body=${text}`);
    }
    return await r.json();
}

module.exports = {
    aiChat: chatCompletionsBigModel,
};
