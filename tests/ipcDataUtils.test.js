const test = require("node:test");
const assert = require("node:assert/strict");

const dataUtils = require("../src/main/ipc/ipcDataUtils");

test("normalizeAssistantContext filters invalid items and trims message", () => {
    const normalized = dataUtils.normalizeAssistantContext([
        {role: "user", message: "  hello  ", createdAt: "2026-03-18"},
        {role: "assistant", message: "  ok "},
        {role: "system", message: "ignore"},
        {role: "user", message: "   "},
    ]);
    assert.equal(normalized.length, 2);
    assert.deepEqual(normalized[0], {role: "user", message: "hello", createdAt: "2026-03-18"});
    assert.equal(normalized[1].message, "ok");
});

test("normalizeMemory helpers classify tags and confidence", () => {
    assert.equal(dataUtils.normalizeMemoryCategory("", "", "我喜欢 TypeScript"), "preference");
    assert.equal(dataUtils.normalizeMemoryCategory("", "项目计划", "repo feature"), "project");
    assert.equal(dataUtils.normalizeMemoryCategory("constraint", "", ""), "constraint");

    const tags = dataUtils.normalizeMemoryTags([" TypeScript ", "typescript", "NodeJS"], "", "");
    assert.deepEqual(tags, ["typescript", "nodejs"]);
    const inferredTags = dataUtils.normalizeMemoryTags([], "开发计划", "今天继续推进OpenAI集成");
    assert.ok(inferredTags.some((item) => item.includes("开发") || item.includes("openai")));

    assert.equal(dataUtils.normalizeMemoryConfidence(1.8), 1);
    assert.equal(dataUtils.normalizeMemoryConfidence(0.01), 0.2);
    assert.equal(dataUtils.normalizeMemoryConfidence("bad"), 0.72);
    assert.equal(dataUtils.normalizeMemoryStatus("archived"), "archived");
    assert.equal(dataUtils.normalizeMemoryStatus("x"), "active");
});

test("buildMemoryFingerprint and isMemoryNoise normalize text", () => {
    const fp = dataUtils.buildMemoryFingerprint("Hello, World!", "Node.js + TypeScript");
    assert.match(fp, /hello/);
    assert.match(fp, /typescript/);

    assert.equal(dataUtils.isMemoryNoise("你好", "谢谢"), true);
    assert.equal(dataUtils.isMemoryNoise("长期偏好", "用户长期偏好 TypeScript 与 Node 开发"), false);
});

test("normalizeLongTermMemory applies defaults and normalization", () => {
    const items = dataUtils.normalizeLongTermMemory([
        {title: "  偏好  ", content: "  喜欢 TypeScript  ", confidence: 0.95, tags: ["TS", "ts"]},
        {title: "", content: "无效"},
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "偏好");
    assert.equal(items[0].content, "喜欢 TypeScript");
    assert.equal(items[0].confidence, 0.95);
    assert.deepEqual(items[0].tags, ["ts"]);
    assert.ok(items[0].id);
    assert.equal(items[0].status, "active");
});

test("normalizeMemoryRoutineMeta fills defaults", () => {
    const defaultMeta = {
        lastExtractionDate: "",
        lastRunAt: "",
        lastStatus: "idle",
        lastAddedCount: 0,
        lastSkippedCount: 0,
        lastError: "",
    };
    const meta = dataUtils.normalizeMemoryRoutineMeta(defaultMeta, {
        lastExtractionDate: "2026-03-18",
        lastRunAt: 123,
        lastStatus: "running",
        lastAddedCount: "3",
        lastSkippedCount: "x",
    });
    assert.equal(meta.lastExtractionDate, "2026-03-18");
    assert.equal(meta.lastRunAt, "");
    assert.equal(meta.lastStatus, "running");
    assert.equal(meta.lastAddedCount, 3);
    assert.equal(meta.lastSkippedCount, 0);
});

test("knowledge card helpers parse markdown and validate payload", () => {
    const stripped = dataUtils.stripMarkdownForSummary("# 标题\n- item\n[link](https://a.com)\n`code`");
    assert.equal(stripped, "标题 item link code");

    const fallback = dataUtils.buildKnowledgeCardFallbackSummary({
        title: "卡片标题",
        content: "这是一个很长很长的内容 ".repeat(8),
    });
    assert.ok(fallback.endsWith("..."));
    assert.ok(fallback.length <= 87);

    const cards = dataUtils.normalizeKnowledgeCards([
        {title: "  A  ", content: " **B** ", source: " user "},
        {title: "", content: "invalid"},
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].title, "A");
    assert.equal(cards[0].content, "**B**");
    assert.equal(cards[0].source, "user");
    assert.ok(cards[0].summary);

    assert.throws(() => dataUtils.validateKnowledgeCardPayload({title: "", content: "x"}), /Card title is required/);
    assert.throws(() => dataUtils.validateKnowledgeCardPayload({title: "x", content: ""}), /Card content is required/);
    const payload = dataUtils.validateKnowledgeCardPayload({
        id: " card-1 ",
        title: "  标题 ",
        content: " 内容 ",
        category: "",
    }, {requireId: true});
    assert.equal(payload.id, "card-1");
    assert.equal(payload.title, "标题");
    assert.equal(payload.content, "内容");
    assert.equal(payload.category, dataUtils.DEFAULT_CARD_CATEGORY);
});
