const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const agentShared = require("../src/main/ipc/agentShared");

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => {
            resolve(server);
        });
    });
}

test("basic utility helpers normalize and parse text", () => {
    assert.equal(typeof agentShared.isoNow(), "string");
    assert.deepEqual(agentShared.safeJsonParse("{\"ok\":true}"), {ok: true});
    assert.equal(agentShared.safeJsonParse("bad-json"), null);

    assert.equal(agentShared.stripMarkdown("**Hello** [world](https://a.com)"), "Hello world");
    assert.equal(agentShared.summarizeText("a".repeat(300), 12), `${"a".repeat(12)}...`);
    assert.equal(agentShared.sanitizeFileName(" test:/中文?.png "), "test-.png");
    assert.equal(agentShared.clampTraceOutput("x".repeat(20), 8), "xxxxxxxx...");
    assert.deepEqual(agentShared.normalizeToolArgs({a: 1}), {a: 1});
    assert.deepEqual(agentShared.normalizeToolArgs("x"), {});
});

test("url and html helpers work as expected", () => {
    const ddg = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fabc";
    assert.equal(agentShared.unwrapDuckDuckGoUrl(ddg), "https://example.com/abc");
    assert.equal(agentShared.unwrapDuckDuckGoUrl("not-a-url"), "not-a-url");

    const html = "<div>Hello &amp; <b>world</b></div><script>alert(1)</script><p>line2</p>";
    const text = agentShared.htmlToPlainText(html);
    assert.match(text, /Hello & world/);
    assert.match(text, /line2/);
    assert.doesNotMatch(text, /alert/);
});

test("search variant helpers build and score query variants", () => {
    const variants = agentShared.buildSearchVariants("帮我查一下 OpenAI Codex 和 Node.js");
    assert.ok(variants.length > 0);
    assert.ok(variants.some((item) => item.text.includes("openai")));

    const score1 = agentShared.scoreSearchVariants("OpenAI Codex docs and Node.js runtime", variants, 1);
    const score2 = agentShared.scoreSearchVariants("天气很好", variants, 1);
    assert.ok(score1 > 0);
    assert.equal(score2, 0);
});

test("requestText handles success redirect and error status", async () => {
    const server = await startServer((req, res) => {
        if (req.url === "/ok") {
            res.writeHead(200, {"Content-Type": "text/plain"});
            res.end("ok-body");
            return;
        }
        if (req.url === "/redirect") {
            res.writeHead(302, {Location: "/ok"});
            res.end();
            return;
        }
        res.writeHead(500, {"Content-Type": "text/plain"});
        res.end("boom");
    });

    const addr = server.address();
    const base = `http://127.0.0.1:${addr.port}`;

    try {
        const ok = await agentShared.requestText(`${base}/ok`);
        assert.equal(ok, "ok-body");

        const redirected = await agentShared.requestText(`${base}/redirect`);
        assert.equal(redirected, "ok-body");

        await assert.rejects(
            () => agentShared.requestText(`${base}/error`),
            /status 500/
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
