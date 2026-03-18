const test = require("node:test");
const assert = require("node:assert/strict");

const assistantPrompt = require("../src/main/ipc/assistantPrompt");
const promptRegistry = require("../src/main/ipc/promptRegistry");

test("buildAssistantChatMessages builds system/context/user messages", () => {
    const messages = assistantPrompt.buildAssistantChatMessages([
        {role: "user", message: "你好", createdAt: "2026-03-18 10:00:00"},
        {role: "assistant", content: "在的"},
    ], "帮我写总结");

    assert.equal(messages.length, 4);
    assert.deepEqual(messages[0], {role: "system", message: promptRegistry.getAssistantPersonaPrompt()});
    assert.equal(messages[1].role, "user");
    assert.equal(messages[1].message, "[2026-03-18 10:00:00] 你好");
    assert.equal(messages[2].message, "在的");
    assert.deepEqual(messages[3], {role: "user", message: "帮我写总结"});
});

test("buildAssistantChatMessages handles non-array context", () => {
    const messages = assistantPrompt.buildAssistantChatMessages(null, "test");
    assert.equal(messages.length, 2);
    assert.equal(messages[1].message, "test");
});

test("buildAssistantFinalAnswerMessages returns OpenAI content blocks", () => {
    const result = assistantPrompt.buildAssistantFinalAnswerMessages({
        contextItems: [{role: "user", message: "旧上下文"}],
        userMessage: "新请求",
        workflowSummary: "流程摘要",
        plannerDraft: "计划草稿",
    });

    assert.equal(result.length, 2);
    assert.equal(result[0].role, "system");
    assert.equal(result[0].content[0].type, "text");
    assert.match(result[0].content[0].text, /最终回答规则/);

    assert.equal(result[1].role, "user");
    assert.equal(result[1].content[0].type, "text");
    assert.match(result[1].content[0].text, /用户原始请求：\n新请求/);
    assert.match(result[1].content[0].text, /工作流摘要：\n流程摘要/);
    assert.match(result[1].content[0].text, /规划草稿：\n计划草稿/);
});
