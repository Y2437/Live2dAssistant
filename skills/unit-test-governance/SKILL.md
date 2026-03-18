---
name: unit-test-governance
description: Define and enforce unit-test standards for this project. Use when adding or refactoring tests under tests/*.test.js, selecting test boundaries for src/main/ipc modules, mocking Electron/runtime dependencies, validating async/error branches, or integrating test execution into npm scripts.
---

# Unit Test Governance

Apply a consistent workflow so unit tests are deterministic, maintainable, and integrated with the existing test chain.

## Workflow

1. Scope the target module and classify logic:
- pure transformation logic
- file I/O persistence logic
- runtime integration logic (clipboard/nativeImage/http/fetch)
- contract and error handling logic
2. Choose test boundary:
- test exported behavior first
- mock dependencies only at process boundary
- avoid asserting internal implementation details
3. Build test cases per function:
- success path
- validation failure path
- edge input path (empty/null/invalid type/range boundary)
- state mutation path (create/update/delete/reorder)
4. Keep tests deterministic:
- use temp files/directories for persistence tests
- avoid network dependency unless explicitly testing network helper behavior
- avoid wall-clock brittle assertions
5. Integrate and verify:
```bash
npm run test:unit
npm test
```
6. Summarize:
- files added/changed
- coverage intention by module
- residual risk and missing scenarios

## Project Conventions

- Use Node built-in test runner and assertions:
```js
const test = require("node:test");
const assert = require("node:assert/strict");
```
- Store tests in `tests/*.test.js`.
- Keep one primary source module per test file.
- Prefer behavior assertions over snapshot-style broad assertions.
- Use `await assert.rejects(...)` for async failure paths.
- Use `assert.throws(...)` only for synchronous failures.

## I/O and Mock Rules

- For file persistence tests:
- create isolated temp directory with `fs.mkdtemp(...)`
- clean with `fs.rm(dir, {recursive: true, force: true})` in `finally`
- never write to real runtime JSON paths
- For Electron-like dependencies:
- inject fake `clipboard` and `nativeImage` objects
- assert outward effects (`writeText`, `writeImage`) and returned payload
- For HTTP helper tests:
- spin up a local `http.createServer(...)` for success/redirect/error paths
- close server in `finally`

## Integration Rules

- Preserve existing chain:
- `npm test` must still run `scripts/auto-test.js` and then unit tests
- Keep `npm run test:unit` focused on `tests/*.test.js`
- Avoid adding heavyweight test dependencies when Node built-ins are sufficient.

## References

- Read `references/unit-test-checklist.md` before large or multi-module test additions.
