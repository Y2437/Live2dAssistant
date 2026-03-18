---
name: frontend-architecture-style-governance
description: Review, refactor, and govern frontend architecture and code style for this Electron project. Use when editing `src/renderer/js/**`, `src/renderer/view/**`, or `src/renderer/css/**`; when optimizing frontend performance; when enforcing module boundaries, event/render patterns, and naming conventions; or when standardizing code for maintainability and consistency.
---

# Frontend Architecture And Style Governance

Apply a consistent workflow to keep renderer architecture stable, frontend runtime efficient, and code style uniform.

## Workflow

1. Locate impacted files and classify the change:
- Architecture change (`view` split, module boundaries, shared utilities)
- Performance change (render loop, event frequency, DOM update strategy)
- Style cleanup (naming, duplication, guard clauses, unsafe HTML, state handling)
2. Keep process boundaries strict:
- Main/preload/renderer responsibilities must not leak.
- Renderer files under `src/renderer/js/<feature>/index.js` should own feature state and behavior.
- Shared helpers belong in `src/renderer/js/shared` or `src/renderer/js/core`.
3. Implement with low-risk refactors first:
- Remove duplicated logic and redundant work in hot paths.
- Add throttling/debouncing or `requestAnimationFrame` batching for frequent UI updates.
- Preserve behavior and data contracts unless explicitly requested to change.
4. Validate before finishing:
```bash
npm test
```
If CSS changed, also run:
```bash
npm run lint:css
```
5. Summarize:
- Changed files
- Performance/maintainability impact
- Residual risk or follow-up suggestions

## Project Rules

- Treat these documents as source of truth:
- `docs/DEVELOPER_ARCHITECTURE_GUIDE.md`
- `docs/PROJECT_ARCHITECTURE_AND_STATUS_REPORT.md`
- `docs/CSS_STYLE_GUIDE.md`
- Keep module prefixes clear (`assistant-*`, `cards-*`, `calendar-*`, `clipboard-*`, `pomo*`, `settings-*`).
- Prefer small pure helpers and explicit state transitions over implicit side effects.
- Prefer early returns, stable naming, and single-responsibility functions.
- Escape untrusted string content before injecting HTML.
- Avoid unconditional high-frequency logs in hot paths.

## Focus Areas For Performance Work

- Repeated `innerHTML` rebuilds on each keystroke or stream chunk
- Frequent layout thrash (`offsetWidth`, style reads/writes interleaving)
- Redundant timers/listeners not scoped to active views
- Continuous animation loops when view is hidden/inactive
- Recreating expensive formatters/parsers in tight loops

For detailed checks, read:
- `references/frontend-architecture-style-checklist.md`
