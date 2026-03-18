---
name: backend-architecture-style-governance
description: Review, refactor, and govern Electron main-process backend JavaScript for this project. Use when editing src/main/**/*.js, optimizing backend performance, reducing unnecessary I/O/allocation in hot paths, unifying code style, or validating backend runtime safety and maintainability.
---

# Backend Architecture Style Governance

Apply a consistent backend workflow so main-process behavior stays fast, deterministic, and easy to maintain.

## Workflow

1. Scope changed backend files in `src/main/**/*.js` and classify the work:
- performance hot path
- data I/O and persistence
- IPC contract or lifecycle
- style/structure cleanup
2. Optimize low-risk hotspots first:
- remove repeated JSON parse/stringify in loops
- remove repeated Set/Map construction in request paths
- reduce unnecessary full-file reads and repeated sorts
- collapse duplicated parse/normalize helpers
3. Keep behavior stable:
- preserve IPC channel names and payload shapes unless explicitly requested
- avoid changing persisted schema layout unless migration is provided
4. Normalize code style:
- use small pure helpers for normalization/comparison
- prefer early returns and explicit input validation
- avoid high-frequency logs in runtime paths
5. Validate:
```bash
npm test
node --check src/main/ipc/ipcRegister.js
```
6. Summarize:
- changed files
- performance/maintainability gain
- residual risk

## Project Focus

- Main process entry and wiring:
- `src/main/main.js`
- `src/main/window/WindowManager.js`
- IPC services/stores:
- `src/main/ipc/*.js`
- Config and runtime limits:
- `src/main/config/*.js`

## Backend Rules

- Treat these as guardrails:
- `scripts/auto-test.js`
- `package.json` scripts
- existing data files under `.env` and runtime JSON paths
- Preserve compatibility for existing renderer invokes in `src/main/preload.js`.
- Prefer single-pass scans over multi-pass filter/map chains in large arrays.
- Prefer lexical compare for normalized `YYYY-MM-DD` date text.
- Keep long-running operations cancellable when hooks/signals exist.

## References

- Read `references/backend-js-performance-checklist.md` before large refactors.
