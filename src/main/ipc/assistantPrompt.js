const {
    getAssistantPersonaPrompt,
    getAssistantFinalAnswerPrompt,
    buildAssistantFinalAnswerUserPrompt,
} = require("./promptRegistry");

function buildAssistantChatMessages(contextItems = [], message = "") {
    return [
        {role: "system", message: getAssistantPersonaPrompt()},
        ...contextItems,
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
