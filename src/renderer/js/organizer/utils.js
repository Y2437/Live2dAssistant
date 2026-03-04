import { CONFIG } from "../core/config.js";

export const CATEGORY_LABELS = CONFIG.ORGANIZER_CONFIG.CATEGORY_LABELS;

export function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
}

export function formatSize(value) {
    const size = Number(value) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function getLanguageFromExt(ext) {
    const value = String(ext || "").replace(/^\./, "").toLowerCase();
    const map = {
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        json: "json",
        html: "html",
        htm: "html",
        xml: "xml",
        css: "css",
        md: "markdown",
        markdown: "markdown",
        py: "python",
        sh: "bash",
        ps1: "bash",
        yml: "yaml",
        yaml: "yaml",
    };
    return map[value] || value || "plaintext";
}

export function categoryLabel(value) {
    return CATEGORY_LABELS[value] || value || "Other";
}

export function buildTree(items) {
    const root = {};
    for (const item of items) {
        const parts = String(item.relativePath || "").split("/");
        let cursor = root;
        for (let index = 0; index < parts.length - 1; index += 1) {
            const part = parts[index];
            if (!part) continue;
            cursor[part] = cursor[part] || {children: {}};
            cursor = cursor[part].children;
        }
    }
    return root;
}

export function buildMarkdownOutline(markdown) {
    return String(markdown || "")
        .split("\n")
        .map((line) => line.match(/^(#{1,6})\s+(.+)$/))
        .filter(Boolean)
        .map((match, index) => ({
            id: `outline-${index + 1}`,
            level: match[1].length,
            text: match[2].trim(),
        }));
}
