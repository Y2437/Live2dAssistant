#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, "tests");

function walkTestFiles(dir, bucket = []) {
    if (!fs.existsSync(dir)) {
        return bucket;
    }
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkTestFiles(fullPath, bucket);
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".test.js")) {
            bucket.push(fullPath);
        }
    }
    return bucket;
}

const testFiles = walkTestFiles(TEST_DIR).sort();
if (!testFiles.length) {
    console.error("No test files found in tests/*.test.js");
    process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    stdio: "inherit",
    env: process.env,
});

if (result.error) {
    throw result.error;
}

process.exit(result.status || 0);
