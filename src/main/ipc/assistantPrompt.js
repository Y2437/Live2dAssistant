const {
    getAssistantPersonaPrompt,
    getAssistantFinalAnswerPrompt,
    buildAssistantFinalAnswerUserPrompt,
} = require("./promptRegistry");

function withTimestampPrefix(message = "", createdAt = "") {
    const text = String(message || "").trim();
    const stamp = typeof createdAt === "string" ? createdAt.trim() : "";
    if (!text) {
        return "";
    }
    return stamp ? `[${stamp}] ${text}` : text;
}


function buildAssistantChatMessages(contextItems = [], message = "") {
    const contextWithTimestamps = Array.isArray(contextItems)
        ? contextItems.map((item) => ({
            role: item?.role,
            message: withTimestampPrefix(item?.message ?? item?.content ?? "", item?.createdAt),
        }))
        : [];
    return [
        {role: "system", message: getAssistantPersonaPrompt()},
        ...contextWithTimestamps,
        {role: "user", message},
    ];
}

function buildAssistantFinalAnswerMessages({contextItems = [], userMessage = "", workflowSummary = "", plannerDraft = ""} = {}) {
    return [
        {
            role: "system",
            content: [{type: "text", text: getAssistantFinalAnswerPrompt()}],
        },
        {
            role: "user",
            content: [{
                type: "text",
                text: buildAssistantFinalAnswerUserPrompt({
                    contextItems,
                    userMessage,
                    workflowSummary,
                    plannerDraft,
                }),
            }],
        },
    ];
}

module.exports = {
    getAssistantPersonaPrompt,
    getAssistantFinalAnswerPrompt,
    buildAssistantChatMessages,
    buildAssistantFinalAnswerMessages,
};
