const fs = require("fs/promises");

function createClipboardStore({dataPath, clipboard, nativeImage, maxItems = 120}) {
    let history = [];
    let fingerprintIndex = new Map();
    let idIndex = new Map();

    function normalizeClipboardHistory(data) {
        if (!Array.isArray(data)) {
            return [];
        }
        return data
            .filter((item) => item && typeof item.id === "string")
            .map((item) => ({
                id: item.id,
                type: item.type === "image" || item.type === "mixed" ? item.type : "text",
                text: typeof item.text === "string" ? item.text : "",
                textPreview: typeof item.textPreview === "string" ? item.textPreview : "",
                hasImage: item.hasImage === true,
                imageWidth: Number.isFinite(Number(item.imageWidth)) ? Number(item.imageWidth) : 0,
                imageHeight: Number.isFinite(Number(item.imageHeight)) ? Number(item.imageHeight) : 0,
                imageDataUrl: typeof item.imageDataUrl === "string" ? item.imageDataUrl : "",
                createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
                source: typeof item.source === "string" ? item.source : "manual",
                pinned: item.pinned === true,
                fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : "",
            }));
    }

    function rebuildIndexes() {
        fingerprintIndex = new Map();
        idIndex = new Map();
        history.forEach((item, index) => {
            if (typeof item?.id === "string" && item.id) {
                idIndex.set(item.id, index);
            }
            if (typeof item?.fingerprint === "string" && item.fingerprint && !fingerprintIndex.has(item.fingerprint)) {
                fingerprintIndex.set(item.fingerprint, index);
            }
        });
    }

    async function saveHistory() {
        await fs.writeFile(dataPath, JSON.stringify(history, null, 2), "utf-8");
    }

    async function loadHistory() {
        try {
            const raw = await fs.readFile(dataPath, "utf8");
            history = normalizeClipboardHistory(JSON.parse(raw));
            rebuildIndexes();
        } catch (error) {
            if (error.code === "ENOENT") {
                history = [];
                rebuildIndexes();
                await saveHistory();
                return;
            }
            throw error;
        }
    }

    function buildClipboardFingerprint(payload) {
        const text = String(payload?.text || "").trim();
        const imagePart = payload?.hasImage
            ? `${payload.imageWidth || 0}x${payload.imageHeight || 0}:${payload.imageDataUrl ? String(payload.imageDataUrl).slice(0, 120) : ""}`
            : "no-image";
        return `${text.slice(0, 300)}|${imagePart}`.toLowerCase();
    }

    function clipTextPreview(text) {
        const value = String(text || "").replace(/\s+/g, " ").trim();
        if (!value) {
            return "";
        }
        return value.length > 120 ? `${value.slice(0, 120).trim()}...` : value;
    }

    function getClipboardSnapshotData() {
        const text = clipboard.readText();
        const image = clipboard.readImage();
        const hasImage = image && !image.isEmpty();
        let imageWidth = 0;
        let imageHeight = 0;
        let imageDataUrl = "";
        if (hasImage) {
            const size = image.getSize();
            imageWidth = size?.width || 0;
            imageHeight = size?.height || 0;
            try {
                const preview = image.resize({width: Math.min(220, imageWidth || 220)});
                imageDataUrl = preview.toDataURL();
            } catch (error) {
                imageDataUrl = "";
            }
        }
        const textValue = typeof text === "string" ? text : "";
        const hasText = Boolean(textValue.trim());
        const type = hasText && hasImage ? "mixed" : (hasImage ? "image" : "text");
        const result = {
            type,
            text: textValue,
            textPreview: clipTextPreview(textValue),
            hasText,
            hasImage,
            imageWidth,
            imageHeight,
            imageDataUrl,
        };
        result.fingerprint = buildClipboardFingerprint(result);
        return result;
    }

    function getClipboardHistoryData() {
        const pinnedCount = history.filter((item) => item.pinned).length;
        return {
            count: history.length,
            pinnedCount,
            items: [...history],
        };
    }

    function trimClipboardHistory() {
        if (history.length <= maxItems) {
            return;
        }
        const pinnedItems = history.filter((item) => item.pinned);
        const normalItems = history.filter((item) => !item.pinned);
        const keepNormalCount = Math.max(0, maxItems - pinnedItems.length);
        history = [...pinnedItems, ...normalItems.slice(0, keepNormalCount)];
    }

    async function captureClipboardRecord(options = {}) {
        const snapshot = getClipboardSnapshotData();
        if (!snapshot.hasText && !snapshot.hasImage) {
            return {
                inserted: false,
                reason: "empty",
                snapshot,
                data: getClipboardHistoryData(),
            };
        }
        const indexedDuplicate = fingerprintIndex.get(snapshot.fingerprint);
        const duplicateSourceIndex = Number.isInteger(indexedDuplicate)
            && indexedDuplicate >= 0
            && indexedDuplicate < history.length
            && history[indexedDuplicate]?.fingerprint === snapshot.fingerprint
            ? indexedDuplicate
            : history.findIndex((item) => item.fingerprint === snapshot.fingerprint);
        if (duplicateSourceIndex !== -1) {
            const existing = history.splice(duplicateSourceIndex, 1)[0];
            const merged = {
                ...existing,
                ...snapshot,
                id: existing.id,
                pinned: existing.pinned === true,
                createdAt: new Date().toISOString(),
                source: options.source || "manual",
            };
            history.unshift(merged);
            rebuildIndexes();
            await saveHistory();
            return {
                inserted: false,
                reason: "duplicate",
                item: merged,
                snapshot,
                data: getClipboardHistoryData(),
            };
        }
        const item = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: snapshot.type,
            text: snapshot.text,
            textPreview: snapshot.textPreview,
            hasImage: snapshot.hasImage,
            imageWidth: snapshot.imageWidth,
            imageHeight: snapshot.imageHeight,
            imageDataUrl: snapshot.imageDataUrl || "",
            fingerprint: snapshot.fingerprint,
            source: options.source || "manual",
            pinned: false,
            createdAt: new Date().toISOString(),
        };
        history.unshift(item);
        trimClipboardHistory();
        rebuildIndexes();
        await saveHistory();
        return {
            inserted: true,
            item,
            snapshot,
            data: getClipboardHistoryData(),
        };
    }

    async function clearClipboardHistory() {
        history = [];
        rebuildIndexes();
        await saveHistory();
        return getClipboardHistoryData();
    }

    async function deleteClipboardItem(id) {
        const itemId = typeof id === "string" ? id.trim() : "";
        if (!itemId) {
            throw new Error("Clipboard item id is required.");
        }
        const next = history.filter((item) => item.id !== itemId);
        if (next.length === history.length) {
            throw new Error("Clipboard item not found.");
        }
        history = next;
        rebuildIndexes();
        await saveHistory();
        return getClipboardHistoryData();
    }

    async function pinClipboardItem(id, pinned = true) {
        const itemId = typeof id === "string" ? id.trim() : "";
        if (!itemId) {
            throw new Error("Clipboard item id is required.");
        }
        const indexed = idIndex.get(itemId);
        const index = Number.isInteger(indexed)
            && indexed >= 0
            && indexed < history.length
            && history[indexed]?.id === itemId
            ? indexed
            : history.findIndex((item) => item.id === itemId);
        if (index === -1) {
            throw new Error("Clipboard item not found.");
        }
        history[index] = {
            ...history[index],
            pinned: pinned === true,
        };
        const updated = history.splice(index, 1)[0];
        if (updated.pinned) {
            history.unshift(updated);
        } else {
            const firstUnpinned = history.findIndex((item) => !item.pinned);
            if (firstUnpinned === -1) {
                history.push(updated);
            } else {
                history.splice(firstUnpinned, 0, updated);
            }
        }
        rebuildIndexes();
        await saveHistory();
        return getClipboardHistoryData();
    }

    async function copyClipboardItem(id) {
        const itemId = typeof id === "string" ? id.trim() : "";
        if (!itemId) {
            throw new Error("Clipboard item id is required.");
        }
        const indexed = idIndex.get(itemId);
        const item = Number.isInteger(indexed)
            && indexed >= 0
            && indexed < history.length
            && history[indexed]?.id === itemId
            ? history[indexed]
            : history.find((entry) => entry.id === itemId);
        if (!item) {
            throw new Error("Clipboard item not found.");
        }
        if (item.text) {
            clipboard.writeText(item.text);
        }
        if (item.hasImage && item.imageDataUrl) {
            try {
                const image = nativeImage.createFromDataURL(item.imageDataUrl);
                if (image && !image.isEmpty()) {
                    clipboard.writeImage(image);
                }
            } catch (error) {
                // Keep text copy successful even if image restore fails.
            }
        }
        return {ok: true, id: item.id};
    }

    return {
        loadHistory,
        getClipboardSnapshotData,
        getClipboardHistoryData,
        captureClipboardRecord,
        clearClipboardHistory,
        deleteClipboardItem,
        pinClipboardItem,
        copyClipboardItem,
    };
}

module.exports = {
    createClipboardStore,
};
