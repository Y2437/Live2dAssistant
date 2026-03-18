const DOMESTIC_MODEL_PROVIDERS = [
    {
        id: "zhipu",
        name: "智谱 AI (BigModel)",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiPath: "/chat/completions",
        requestFormat: "zhipu",
        chatModels: [
            {id: "glm-5-turbo", label: "GLM-5-Turbo"},
            {id: "glm-5", label: "GLM-5"},
            {id: "glm-4.7", label: "GLM-4.7"},
            {id: "glm-4.7-flash", label: "GLM-4.7-Flash"},
            {id: "glm-4.7-flashx", label: "GLM-4.7-FlashX"},
            {id: "glm-4.6", label: "GLM-4.6"},
            {id: "glm-4.5-air", label: "GLM-4.5-Air"},
            {id: "glm-4.5-airx", label: "GLM-4.5-AirX"},
            {id: "glm-4.5-flash", label: "GLM-4.5-Flash"},
        ],
        summaryModels: [
            {id: "glm-4.5-air", label: "GLM-4.5-Air"},
            {id: "glm-4.5-airx", label: "GLM-4.5-AirX"},
            {id: "glm-4.7-flash", label: "GLM-4.7-Flash"},
            {id: "glm-5-turbo", label: "GLM-5-Turbo"},
        ],
        visionModels: [
            {id: "glm-4.6v", label: "GLM-4.6V"},
            {id: "glm-4.1v-thinking-flashx", label: "GLM-4.1V-Thinking-FlashX"},
            {id: "glm-4.1v-thinking", label: "GLM-4.1V-Thinking"},
        ],
    },
    {
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        apiPath: "/chat/completions",
        requestFormat: "openai",
        chatModels: [
            {id: "deepseek-chat", label: "DeepSeek Chat"},
            {id: "deepseek-reasoner", label: "DeepSeek Reasoner"},
        ],
    },
    {
        id: "dashscope",
        name: "阿里云百炼 DashScope",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiPath: "/chat/completions",
        requestFormat: "openai",
        chatModels: [
            {id: "qwen3-max", label: "Qwen3 Max"},
            {id: "qwen-max-latest", label: "Qwen Max Latest"},
            {id: "qwen3.5-plus", label: "Qwen3.5 Plus"},
            {id: "qwen-plus-latest", label: "Qwen Plus Latest"},
            {id: "qwen3.5-flash", label: "Qwen3.5 Flash"},
            {id: "qwen-turbo-latest", label: "Qwen Turbo Latest"},
            {id: "qwen3-coder-plus", label: "Qwen3 Coder Plus"},
            {id: "qwen-coder-plus-latest", label: "Qwen Coder Plus Latest"},
        ],
        summaryModels: [
            {id: "qwen3.5-flash", label: "Qwen3.5 Flash"},
            {id: "qwen-plus-latest", label: "Qwen Plus Latest"},
            {id: "qwen-max-latest", label: "Qwen Max Latest"},
        ],
        visionModels: [
            {id: "qwen-vl-max-latest", label: "Qwen VL Max Latest"},
            {id: "qvq-max-latest", label: "QVQ Max Latest"},
        ],
    },
    {
        id: "moonshot",
        name: "月之暗面 Moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        apiPath: "/chat/completions",
        requestFormat: "openai",
        chatModels: [
            {id: "kimi-k2.5", label: "Kimi K2.5"},
            {id: "kimi-k2-0905-preview", label: "Kimi K2 0905 Preview"},
            {id: "kimi-k2-0711-preview", label: "Kimi K2 0711 Preview"},
            {id: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo Preview"},
            {id: "kimi-k2-thinking-turbo", label: "Kimi K2 Thinking Turbo"},
            {id: "kimi-k2-thinking", label: "Kimi K2 Thinking"},
            {id: "moonshot-v1-auto", label: "Moonshot V1 Auto"},
            {id: "moonshot-v1-8k", label: "Moonshot V1 8K"},
            {id: "moonshot-v1-32k", label: "Moonshot V1 32K"},
            {id: "moonshot-v1-128k", label: "Moonshot V1 128K"},
            {id: "kimi-latest", label: "Kimi Latest"},
            {id: "kimi-thinking-preview", label: "Kimi Thinking Preview"},
        ],
        visionModels: [
            {id: "moonshot-v1-8k-vision-preview", label: "Moonshot V1 8K Vision Preview"},
            {id: "moonshot-v1-32k-vision-preview", label: "Moonshot V1 32K Vision Preview"},
            {id: "moonshot-v1-128k-vision-preview", label: "Moonshot V1 128K Vision Preview"},
            {id: "kimi-latest", label: "Kimi Latest"},
            {id: "kimi-thinking-preview", label: "Kimi Thinking Preview"},
            {id: "kimi-k2.5", label: "Kimi K2.5"},
        ],
    },
    {
        id: "hunyuan",
        name: "腾讯混元 Hunyuan",
        baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
        apiPath: "/chat/completions",
        requestFormat: "openai",
        chatModels: [
            {id: "hunyuan-turbos-latest", label: "Hunyuan TurboS Latest"},
        ],
        visionModels: [
            {id: "hunyuan-vision", label: "Hunyuan Vision"},
        ],
    },
    {
        id: "qianfan",
        name: "百度千帆 Qianfan",
        baseUrl: "https://qianfan.baidubce.com/v2",
        apiPath: "/chat/completions",
        requestFormat: "openai",
        chatModels: [
            {id: "ernie-4.5-turbo-32k", label: "ERNIE 4.5 Turbo 32K"},
            {id: "ernie-5.0", label: "ERNIE 5.0"},
            {id: "ernie-x1.1", label: "ERNIE X1.1"},
            {id: "deepseek-v3.2-think", label: "DeepSeek V3.2 Think"},
            {id: "glm-5", label: "GLM-5"},
        ],
        visionModels: [
            {id: "ernie-4.5-vl-32k", label: "ERNIE 4.5 VL 32K"},
            {id: "ernie-4.5-vl-424b-a47b", label: "ERNIE 4.5 VL"},
        ],
    },
    {
        id: "siliconflow",
        name: "硅基流动 SiliconFlow",
        baseUrl: "https://api.siliconflow.cn/v1",
        apiPath: "/chat/completions",
        requestFormat: "openai",
        chatModels: [
            {id: "Pro/zai-org/GLM-5", label: "GLM-5 (Pro)"},
            {id: "Pro/zai-org/GLM-4.7", label: "GLM-4.7 (Pro)"},
            {id: "deepseek-ai/DeepSeek-V3.2", label: "DeepSeek-V3.2"},
            {id: "Qwen/Qwen3-32B", label: "Qwen3 32B"},
        ],
        summaryModels: [
            {id: "Qwen/Qwen3-8B", label: "Qwen3 8B"},
            {id: "Qwen/Qwen3-14B", label: "Qwen3 14B"},
            {id: "Pro/zai-org/GLM-4.7", label: "GLM-4.7 (Pro)"},
        ],
        visionModels: [
            {id: "zai-org/GLM-4.5V", label: "GLM-4.5V"},
            {id: "zai-org/GLM-4.6", label: "GLM-4.6"},
        ],
    },
];

const PROVIDER_ID_ALIAS = {
    bigmodel: "zhipu",
    bigmodel_glm: "zhipu",
    glm: "zhipu",
};

function cloneModels(models = []) {
    return models.map((model) => ({...model}));
}

function cloneProvider(provider) {
    const chatModels = Array.isArray(provider.chatModels) ? cloneModels(provider.chatModels) : [];
    const summaryModels = Array.isArray(provider.summaryModels) && provider.summaryModels.length
        ? cloneModels(provider.summaryModels)
        : cloneModels(chatModels);
    const visionModels = Array.isArray(provider.visionModels) && provider.visionModels.length
        ? cloneModels(provider.visionModels)
        : cloneModels(chatModels);

    return {
        ...provider,
        chatModels,
        summaryModels,
        visionModels,
    };
}

function listModelProviders() {
    return DOMESTIC_MODEL_PROVIDERS.map((provider) => cloneProvider(provider));
}

function findModelProvider(providerId = "") {
    const normalizedId = String(providerId || "").trim().toLowerCase();
    const resolvedId = PROVIDER_ID_ALIAS[normalizedId] || normalizedId;
    return DOMESTIC_MODEL_PROVIDERS.find((item) => item.id === resolvedId) || null;
}

module.exports = {
    DOMESTIC_MODEL_PROVIDERS,
    listModelProviders,
    findModelProvider,
};
