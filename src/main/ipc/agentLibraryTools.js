const fs = require("fs/promises");
const path = require("path");
const {PDFParse} = require("pdf-parse");
const {AGENT_LIBRARY_INDEX_JSON_PATH} = require("../config");
const {
    MAX_FILE_SIZE,
    MAX_FILE_RESULT_CHARS,
    INDEXABLE_EXTENSIONS,
    TEXT_EXTENSIONS,
    IGNORED_DIRS,
    isoNow,
    summarizeText,
    tokenizeSearchText,
    buildSearchIndex,
    buildFileCategory,
    buildFileSignature,
    buildTextChunks,
    scoreSearchMatch,
} = require("./agentShared");

// Library indexing and retrieval helpers for the agent.

async function extractPdfText(fullPath) {
    const data = await fs.readFile(fullPath);
    const parser = new PDFParse({data});
    try {
        const result = await parser.getText({
            pageSeparator: "\n\n",
        });
        return String(result?.text || "")
            .replace(/\u0000/g, " ")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[^\S\n]{2,}/g, " ")
            .trim();
    } finally {
        await parser.destroy().catch(() => {});
    }
}

async function rebuildLibraryIndex(service) {
    const previousItems = Array.isArray(service.libraryIndex.items) ? service.libraryIndex.items : [];
    const previousMap = new Map(previousItems.map((item) => [item.id, item]));
    const items = [];
    const seenIds = new Set();
    const stats = {added: 0, updated: 0, unchanged: 0, removed: 0, oversize: 0, errors: 0};
    for (const root of service.libraryRoots) {
        await walkLibraryRoot(service, root, items, root, previousMap, stats, seenIds);
    }
    for (const previous of previousItems) {
        if (!seenIds.has(previous.id)) {
            stats.removed += 1;
        }
    }
    const categories = Object.entries(items.reduce((acc, item) => {
        const key = item.category || "other";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {})).map(([key, count]) => ({key, count}))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    service.libraryIndex = {updatedAt: isoNow(), items, stats, categories};
    await fs.writeFile(AGENT_LIBRARY_INDEX_JSON_PATH, JSON.stringify(service.libraryIndex, null, 2), "utf8");
}

function buildLibraryItem(service, root, fullPath, stat, ext, excerpt, status, options = {}) {
    const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
    const name = path.basename(fullPath);
    const searchIndex = buildSearchIndex(`${relativePath}\n${name}\n${excerpt}\n${options.searchableText || ""}`);
    return {
        id: `${root}::${relativePath}`,
        root,
        relativePath,
        fullPath,
        name,
        ext,
        category: buildFileCategory(ext),
        excerpt,
        status,
        size: stat?.size ?? 0,
        mtimeMs: stat?.mtimeMs ?? 0,
        signature: options.signature || "",
        chunkCount: Array.isArray(options.chunks) ? options.chunks.length : 0,
        searchIndex,
        chunks: Array.isArray(options.chunks) ? options.chunks : [],
    };
}

async function walkLibraryRoot(service, root, items, currentDir = root, previousMap = new Map(), stats = null, seenIds = new Set()) {
    let entries = [];
    try {
        entries = await fs.readdir(currentDir, {withFileTypes: true});
    } catch (error) {
        console.warn("[agent] walkLibraryRoot failed:", currentDir, error.message);
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) {
                continue;
            }
            await walkLibraryRoot(service, root, items, fullPath, previousMap, stats, seenIds);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (!INDEXABLE_EXTENSIONS.has(ext)) {
            continue;
        }
        try {
            const stat = await fs.stat(fullPath);
            const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
            const id = `${root}::${relativePath}`;
            const signature = buildFileSignature(stat);
            const previous = previousMap.get(id);
            seenIds.add(id);
            if (stat.size > MAX_FILE_SIZE) {
                items.push(buildLibraryItem(service, root, fullPath, stat, ext, "", "oversize", {signature}));
                if (stats) stats.oversize += 1;
                continue;
            }
            if (previous && previous.signature === signature) {
                items.push({
                    ...previous,
                    root,
                    relativePath,
                    fullPath,
                    name: path.basename(fullPath),
                    ext,
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                    signature,
                });
                if (stats) stats.unchanged += 1;
                continue;
            }
            let excerpt = "";
            let searchableText = "";
            let chunks = [];
            if (TEXT_EXTENSIONS.has(ext)) {
                const content = await fs.readFile(fullPath, "utf8");
                excerpt = summarizeText(content, 320);
                searchableText = content.slice(0, 24000);
                chunks = buildTextChunks(content);
            } else if (ext === ".pdf") {
                const content = await extractPdfText(fullPath);
                if (content) {
                    excerpt = summarizeText(content, 320);
                    searchableText = content.slice(0, 24000);
                    chunks = buildTextChunks(content);
                } else {
                    excerpt = "PDF text extraction returned no readable text.";
                }
            }
            items.push(buildLibraryItem(service, root, fullPath, stat, ext, excerpt, "ready", {searchableText, chunks, signature}));
            if (stats) {
                if (previous) {
                    stats.updated += 1;
                } else {
                    stats.added += 1;
                }
            }
        } catch (error) {
            items.push(buildLibraryItem(service, root, fullPath, null, ext, error.message, "error"));
            if (stats) stats.errors += 1;
        }
    }
}

function getLibraryIndexData(service) {
    return {
        updatedAt: service.libraryIndex.updatedAt,
        rootCount: service.libraryRoots.length,
        categories: Array.isArray(service.libraryIndex.categories) ? service.libraryIndex.categories : [],
        stats: service.libraryIndex.stats || null,
        items: service.libraryIndex.items.map((item) => ({
            id: item.id,
            root: item.root,
            relativePath: item.relativePath,
            fullPath: item.fullPath,
            name: item.name,
            ext: item.ext,
            category: item.category || buildFileCategory(item.ext),
            excerpt: item.excerpt,
            status: item.status,
            size: item.size,
            mtimeMs: item.mtimeMs,
            chunkCount: item.chunkCount || 0,
        })),
    };
}

function searchLibrary(service, query) {
    const value = String(query || "").trim();
    const normalized = value.toLowerCase();
    const tokens = tokenizeSearchText(value);
    const ranked = service.libraryIndex.items.map((item) => {
        const baseScore = scoreSearchMatch(normalized, item.searchIndex || "", tokens, 1.8);
        const matches = (item.chunks || []).map((chunk) => ({
            chunkId: chunk.id,
            preview: chunk.preview,
            score: scoreSearchMatch(normalized, chunk.searchIndex || "", tokens, 1.2),
        })).filter((chunk) => chunk.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        const totalScore = baseScore + matches.reduce((sum, chunk) => sum + chunk.score, 0);
        return {item, totalScore, matches};
    }).filter((entry) => !value || entry.totalScore > 0)
        .sort((a, b) => b.totalScore - a.totalScore || b.item.mtimeMs - a.item.mtimeMs)
        .slice(0, 16)
        .map(({item, totalScore, matches}) => ({
            path: item.relativePath,
            relativePath: item.relativePath,
            name: item.name,
            ext: item.ext,
            category: item.category || buildFileCategory(item.ext),
            status: item.status,
            excerpt: matches[0]?.preview || item.excerpt,
            score: Number(totalScore.toFixed(2)),
            chunkCount: item.chunkCount || 0,
            matches,
        }));
    return {updatedAt: service.libraryIndex.updatedAt, query: value, queryTokens: tokens, items: ranked};
}

function getLibraryOverview(service) {
    const recentFiles = [...service.libraryIndex.items]
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 10)
        .map((item) => ({
            path: item.relativePath,
            ext: item.ext,
            updatedAt: item.mtimeMs ? new Date(item.mtimeMs).toISOString() : "",
            excerpt: item.excerpt,
            chunkCount: item.chunkCount || 0,
        }));
    return {
        updatedAt: service.libraryIndex.updatedAt,
        rootCount: service.libraryRoots.length,
        fileCount: service.libraryIndex.items.length,
        chunkCount: service.libraryIndex.items.reduce((sum, item) => sum + (item.chunkCount || 0), 0),
        recentFiles,
    };
}

async function readLibraryFile(service, requestedPath) {
    const value = String(requestedPath || "").trim().replace(/\\/g, "/");
    if (!value) throw new Error("File path is required.");
    const file = service.libraryIndex.items.find((item) => {
        return item.relativePath === value
            || item.name === value
            || item.relativePath.toLowerCase() === value.toLowerCase()
            || item.name.toLowerCase() === value.toLowerCase()
            || item.relativePath.toLowerCase().includes(value.toLowerCase());
    });
    if (!file) throw new Error(`File not found: ${value}`);
    if (file.ext === ".pdf") {
        let content = "";
        let textError = "";
        try {
            content = await extractPdfText(file.fullPath);
        } catch (error) {
            textError = error?.message || String(error);
        }
        return {
            path: file.relativePath,
            fullPath: file.fullPath,
            ext: file.ext,
            category: file.category || buildFileCategory(file.ext),
            status: file.status,
            size: file.size,
            chunkCount: file.chunkCount || 0,
            mode: "pdf",
            content: content.length > MAX_FILE_RESULT_CHARS ? `${content.slice(0, MAX_FILE_RESULT_CHARS)}\n...` : content,
            textError,
            matches: (file.chunks || []).slice(0, 3).map((chunk) => ({chunkId: chunk.id, preview: chunk.preview})),
        };
    }
    if (!TEXT_EXTENSIONS.has(file.ext)) {
        return {
            path: file.relativePath,
            fullPath: file.fullPath,
            ext: file.ext,
            category: file.category || buildFileCategory(file.ext),
            status: file.status,
            size: file.size,
            chunkCount: file.chunkCount || 0,
            mode: "binary",
            content: "Binary file preview is not supported.",
            matches: [],
        };
    }
    const content = await fs.readFile(file.fullPath, "utf8");
    return {
        path: file.relativePath,
        fullPath: file.fullPath,
        ext: file.ext,
        category: file.category || buildFileCategory(file.ext),
        status: file.status,
        size: file.size,
        chunkCount: file.chunkCount || 0,
        mode: "text",
        content: content.length > MAX_FILE_RESULT_CHARS ? `${content.slice(0, MAX_FILE_RESULT_CHARS)}\n...` : content,
        matches: (file.chunks || []).slice(0, 3).map((chunk) => ({chunkId: chunk.id, preview: chunk.preview})),
    };
}

module.exports = {rebuildLibraryIndex, buildLibraryItem, walkLibraryRoot, getLibraryIndexData, searchLibrary, getLibraryOverview, readLibraryFile};
