const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {createClipboardStore} = require("../src/main/ipc/clipboardStore");

function createImageMock({empty = false, width = 0, height = 0, dataUrl = ""} = {}) {
    return {
        isEmpty: () => empty,
        getSize: () => ({width, height}),
        resize: () => ({
            toDataURL: () => dataUrl,
        }),
        toDataURL: () => dataUrl,
    };
}

function createClipboardMock() {
    let text = "";
    let image = createImageMock({empty: true});
    const writes = {
        text: [],
        image: [],
    };
    return {
        readText: () => text,
        readImage: () => image,
        writeText: (value) => {
            text = value;
            writes.text.push(value);
        },
        writeImage: (value) => {
            image = value;
            writes.image.push(value);
        },
        setText: (value) => {
            text = value;
        },
        setImage: (value) => {
            image = value;
        },
        writes,
    };
}

async function createTempClipboardPath() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "live2d-clipboard-"));
    return {
        dir,
        dataPath: path.join(dir, "clipboard.json"),
        async cleanup() {
            await fs.rm(dir, {recursive: true, force: true});
        },
    };
}

test("loadHistory creates file and captureClipboardRecord deduplicates", async () => {
    const temp = await createTempClipboardPath();
    const clipboard = createClipboardMock();
    const nativeImage = {
        createFromDataURL: (dataUrl) => createImageMock({empty: !dataUrl, width: 10, height: 10, dataUrl}),
    };
    const store = createClipboardStore({dataPath: temp.dataPath, clipboard, nativeImage, maxItems: 120});
    try {
        await store.loadHistory();
        assert.deepEqual(JSON.parse(await fs.readFile(temp.dataPath, "utf8")), []);

        clipboard.setText("hello world");
        const first = await store.captureClipboardRecord({source: "manual"});
        assert.equal(first.inserted, true);
        assert.equal(first.data.count, 1);

        const duplicate = await store.captureClipboardRecord({source: "auto"});
        assert.equal(duplicate.inserted, false);
        assert.equal(duplicate.reason, "duplicate");
        assert.equal(duplicate.data.count, 1);
        assert.equal(duplicate.item.source, "auto");
    } finally {
        await temp.cleanup();
    }
});

test("trim, pin, delete and clear clipboard history", async () => {
    const temp = await createTempClipboardPath();
    const clipboard = createClipboardMock();
    const nativeImage = {createFromDataURL: () => createImageMock({empty: true})};
    const store = createClipboardStore({dataPath: temp.dataPath, clipboard, nativeImage, maxItems: 2});
    try {
        await store.loadHistory();
        clipboard.setText("item-1");
        const a = await store.captureClipboardRecord();
        clipboard.setText("item-2");
        const b = await store.captureClipboardRecord();
        clipboard.setText("item-3");
        await store.captureClipboardRecord();

        const listAfterTrim = store.getClipboardHistoryData();
        assert.equal(listAfterTrim.count, 2);

        const pinTargetId = listAfterTrim.items[1].id;
        const pinResult = await store.pinClipboardItem(pinTargetId, true);
        assert.equal(pinResult.pinnedCount, 1);
        assert.equal(pinResult.items[0].id, pinTargetId);

        const deleteResult = await store.deleteClipboardItem(b.item.id);
        assert.equal(deleteResult.count, 1);

        const cleared = await store.clearClipboardHistory();
        assert.equal(cleared.count, 0);
    } finally {
        await temp.cleanup();
    }
});

test("copyClipboardItem writes text and image", async () => {
    const temp = await createTempClipboardPath();
    const clipboard = createClipboardMock();
    const nativeImage = {
        createFromDataURL: (dataUrl) => createImageMock({empty: false, width: 64, height: 64, dataUrl}),
    };
    const store = createClipboardStore({dataPath: temp.dataPath, clipboard, nativeImage, maxItems: 10});
    try {
        await store.loadHistory();

        clipboard.setText("with-image");
        clipboard.setImage(createImageMock({
            empty: false,
            width: 300,
            height: 200,
            dataUrl: "data:image/png;base64,AAAA",
        }));
        const captured = await store.captureClipboardRecord();
        const copied = await store.copyClipboardItem(captured.item.id);
        assert.equal(copied.ok, true);
        assert.equal(clipboard.writes.text.at(-1), "with-image");
        assert.equal(clipboard.writes.image.length, 1);

        await assert.rejects(() => store.copyClipboardItem(""), /Clipboard item id is required/);
        await assert.rejects(() => store.deleteClipboardItem("missing"), /Clipboard item not found/);
    } finally {
        await temp.cleanup();
    }
});
