#!/usr/bin/env node

const {spawnSync} = require("child_process");

function runStep(label, args) {
    console.log(`\n[RUN] ${label}`);
    const result = spawnSync(process.execPath, args, {
        stdio: "inherit",
        env: process.env,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

runStep("Auto checks", ["scripts/auto-test.js"]);
runStep("Unit tests", ["scripts/run-unit-tests.js"]);

console.log("\nAll tests passed.");
