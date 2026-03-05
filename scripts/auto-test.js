#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "build", ".idea", "CubismSdkForWeb-5-r.4"]);

let failures = 0;
let checks = 0;

function log(title, ok, details = []) {
    checks += 1;
    const icon = ok ? "PASS" : "FAIL";
    console.log(`\n[${icon}] ${title}`);
    if (details.length) {
        details.forEach((item) => console.log(`  - ${item}`));
    }
    if (!ok) {
        failures += 1;
    }
}

function walkFiles(dir, predicate, bucket = []) {
    if (!fs.existsSync(dir)) return bucket;
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walkFiles(path.join(dir, entry.name), predicate, bucket);
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (predicate(fullPath)) bucket.push(fullPath);
    }
    return bucket;
}

function toRel(filePath) {
    return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function checkRequiredFiles() {
    const required = [
        "package.json",
        "src/main/main.js",
        "src/main/preload.js",
        "src/main/ipc/ipcRegisterHandlers.js",
        "src/renderer/view/index.html",
        "src/renderer/js/assistant/index.js",
        "src/renderer/js/cards/index.js",
        "src/renderer/js/pomodoro/index.js",
    ];
    const missing = required.filter((item) => !fs.existsSync(path.join(ROOT, item)));
    log("关键入口文件存在性", missing.length === 0, missing.map((item) => `missing: ${item}`));
}

function checkJsonFiles() {
    const jsonFiles = walkFiles(ROOT, (file) => file.endsWith(".json"));
    const bad = [];
    for (const file of jsonFiles) {
        try {
            JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (error) {
            bad.push(`${toRel(file)} -> ${error.message}`);
        }
    }
    log("JSON 文件可解析性", bad.length === 0, bad.slice(0, 20));
}

function isLocalRef(ref) {
    if (!ref) return false;
    if (ref.startsWith("#")) return false;
    if (/^(https?:|data:|javascript:|mailto:)/i.test(ref)) return false;
    return true;
}

function checkHtmlLocalRefs() {
    const htmlFiles = walkFiles(path.join(ROOT, "src/renderer/view"), (file) => file.endsWith(".html"));
    const missing = [];
    const attrPattern = /\b(?:src|href)="([^"]+)"/g;
    for (const htmlFile of htmlFiles) {
        const content = fs.readFileSync(htmlFile, "utf8");
        let match;
        while ((match = attrPattern.exec(content)) !== null) {
            const ref = match[1];
            if (!isLocalRef(ref)) continue;
            const resolved = path.resolve(path.dirname(htmlFile), ref);
            if (!fs.existsSync(resolved)) {
                missing.push(`${toRel(htmlFile)} -> ${ref}`);
            }
        }
    }
    log("HTML 本地资源引用完整性", missing.length === 0, missing.slice(0, 20));
}

function collectByRegex(filePath, regex) {
    const content = fs.readFileSync(filePath, "utf8");
    const set = new Set();
    let match;
    while ((match = regex.exec(content)) !== null) {
        set.add(match[1]);
    }
    return set;
}

function checkIpcContract() {
    const preloadPath = path.join(ROOT, "src/main/preload.js");
    const handlerPath = path.join(ROOT, "src/main/ipc/ipcRegisterHandlers.js");
    if (!fs.existsSync(preloadPath) || !fs.existsSync(handlerPath)) {
        log("IPC invoke/handle 一致性", false, ["preload.js 或 ipcRegisterHandlers.js 缺失"]);
        return;
    }
    const invokes = collectByRegex(preloadPath, /invoke\("([^"]+)"/g);
    const handles = collectByRegex(handlerPath, /ipcMain\.handle\("([^"]+)"/g);
    const missingHandle = [...invokes].filter((item) => item.startsWith("app:") && !handles.has(item));
    const missingInvoke = [...handles].filter((item) => item.startsWith("app:") && !invokes.has(item));

    const details = [];
    missingHandle.forEach((item) => details.push(`invoke 无对应 handler: ${item}`));
    missingInvoke.forEach((item) => details.push(`handler 未被 preload 暴露: ${item}`));

    log("IPC invoke/handle 一致性", details.length === 0, details);
}

function checkLegacyKeywords() {
    const targets = ["src", "PROJECT_REQUIREMENTS_AND_ARCHITECTURE.md"].map((item) => path.join(ROOT, item));
    const patterns = [
        /资料管理器/g,
        /资料整理器/g,
        /\borganizer\b/gi,
        /\bsearch_library\b/g,
        /\bread_library_file\b/g,
        /\bget_library_overview\b/g,
        /\bAGENT_LIBRARY\b/g,
    ];
    const hitList = [];
    const files = [];
    for (const target of targets) {
        if (!fs.existsSync(target)) continue;
        const stat = fs.statSync(target);
        if (stat.isFile()) {
            files.push(target);
        } else {
            walkFiles(target, (file) => {
                const lower = file.toLowerCase();
                return !lower.endsWith(".png") && !lower.endsWith(".moc3") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg");
            }, files);
        }
    }

    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        for (const pattern of patterns) {
            if (pattern.test(content)) {
                hitList.push(`${toRel(file)} -> ${pattern}`);
            }
        }
    }
    log("遗留关键字清理检查", hitList.length === 0, hitList.slice(0, 20));
}

function checkMainSyntax() {
    const mainFiles = walkFiles(path.join(ROOT, "src/main"), (file) => file.endsWith(".js"));
    const bad = [];
    for (const file of mainFiles) {
        const result = spawnSync(process.execPath, ["--check", file], {encoding: "utf8"});
        if (result.status !== 0) {
            const msg = (result.stderr || result.stdout || "").trim().split(/\r?\n/)[0] || "syntax error";
            bad.push(`${toRel(file)} -> ${msg}`);
        }
    }
    log("主进程 JS 语法检查", bad.length === 0, bad.slice(0, 20));
}

function main() {
    console.log("Live2dAssistant 自动化测试开始...");
    checkRequiredFiles();
    checkJsonFiles();
    checkHtmlLocalRefs();
    checkIpcContract();
    checkLegacyKeywords();
    checkMainSyntax();

    console.log(`\n完成: ${checks} 项检查, 失败: ${failures}`);
    if (failures > 0) {
        process.exitCode = 1;
    }
}

main();
