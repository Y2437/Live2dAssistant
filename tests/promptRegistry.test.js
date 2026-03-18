const test = require("node:test");
const assert = require("node:assert/strict");

const promptRegistry = require("../src/main/ipc/promptRegistry");

test("getAgentToolSpecs returns cloned list", () => {
    const specs = promptRegistry.getAgentToolSpecs();
    assert.ok(Array.isArray(specs));
    assert.ok(specs.length > 0);

    const originalFirstName = specs[0].name;
    specs[0].name = "mutated-name";

    const nextSpecs = promptRegistry.getAgentToolSpecs();
    assert.equal(nextSpecs[0].name, originalFirstName);
});

test("filterAgentToolSpecs respects allowlist and prefetchableOnly", () => {
    const filtered = promptRegistry.filterAgentToolSpecs(["web_search", "get_clipboard"], {prefetchableOnly: true});
    assert.deepEqual(filtered.map((item) => item.name).sort(), ["get_clipboard", "web_search"]);
    assert.ok(filtered.every((item) => item.prefetchable === true));
});

test("formatAssistantContextItems formats role, timestamp and fallback text", () => {
    const text = promptRegistry.formatAssistantContextItems([
        {role: "user", message: "  你好  ", createdAt: "2026-03-18 12:00:00"},
        {role: "assistant", content: ""},
    ]);
    assert.match(text, /用户: \[2026-03-18 12:00:00\] 你好/);
    assert.match(text, /助手: （空）/);
    assert.equal(promptRegistry.formatAssistantContextItems([]), promptRegistry.NO_RECENT_CONTEXT_TEXT);
});

test("buildAssistantFinalAnswerUserPrompt includes optional workflow sections", () => {
    const text = promptRegistry.buildAssistantFinalAnswerUserPrompt({
        contextItems: [{role: "user", message: "A"}],
        userMessage: "请总结",
        workflowSummary: "摘要1",
        plannerDraft: "草稿1",
    });

    assert.match(text, /用户原始请求：\n请总结/);
    assert.match(text, /最近对话上下文：/);
    assert.match(text, /工作流摘要：\n摘要1/);
    assert.match(text, /规划草稿：\n草稿1/);
});

test("buildAgentPlanningSystemPrompt supports direct and internal modes", () => {
    const directPrompt = promptRegistry.buildAgentPlanningSystemPrompt({
        directOutput: true,
        contextText: "ctx",
        memoryText: "mem",
        allowedTools: ["web_search"],
    });
    const internalPrompt = promptRegistry.buildAgentPlanningSystemPrompt({
        directOutput: false,
        contextText: "ctx",
        memoryText: "mem",
        allowedTools: ["web_search"],
    });

    assert.match(directPrompt, /会直接展示给用户/);
    assert.match(internalPrompt, /内部规划产物/);
    assert.match(internalPrompt, /禁止伪造工具结果/);
    assert.match(directPrompt, /web_search/);
});

test("buildMemoryExtractionMessages and buildAiDiaryWriterMessages format payloads", () => {
    const extraction = promptRegistry.buildMemoryExtractionMessages([
        {role: "user", message: "我喜欢 TypeScript"},
        {role: "assistant", message: "了解"},
    ]);
    assert.equal(extraction.length, 2);
    assert.match(extraction[1].message, /1\. 用户: 我喜欢 TypeScript/);
    assert.match(extraction[1].message, /2\. 助手: 了解/);

    const diary = promptRegistry.buildAiDiaryWriterMessages({
        date: "2026-03-18",
        prompt: "记录今天开发进展",
        contextText: "修复了测试",
    });
    assert.equal(diary.length, 2);
    assert.match(diary[1].message, /日期：2026-03-18/);
    assert.match(diary[1].message, /补充提示：记录今天开发进展/);
    assert.match(diary[1].message, /上下文：修复了测试/);
});
