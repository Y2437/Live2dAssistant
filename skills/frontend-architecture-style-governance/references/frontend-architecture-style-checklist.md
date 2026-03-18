# Frontend Architecture And Style Checklist

Use this checklist when refactoring renderer code or reviewing frontend changes.

## 1. Architecture Boundaries

- Keep Node/file system access in main process only.
- Keep bridge calls in `window.api` and avoid hidden IPC channels.
- Keep feature logic in feature modules:
- `src/renderer/js/assistant/index.js`
- `src/renderer/js/cards/index.js`
- `src/renderer/js/pomodoro/index.js`
- `src/renderer/js/clipboard/index.js`
- Keep shared primitives in:
- `src/renderer/js/shared/*`
- `src/renderer/js/core/config.js`

## 2. State And Rendering Discipline

- Keep one state source per feature module.
- Use event delegation for repeated list/card items.
- Batch high-frequency updates with `requestAnimationFrame`.
- Add debounce/throttle for search, scroll, resize, and streaming UI updates.
- Reuse expensive objects (`Intl.DateTimeFormat`, regexes, compiled templates) instead of recreating them in loops.

## 3. DOM Safety And Predictability

- Use `textContent` whenever rich HTML is not required.
- Escape dynamic values before assigning to `innerHTML`.
- Avoid mixing read/write layout operations in tight loops.
- Prefer `DocumentFragment` for large list insertions.

## 4. Naming And Code Style

- Use clear module-oriented names (`cardsState`, `clipboardDom`, `assistantState`).
- Prefer `const`; use `let` only when reassignment is required.
- Keep functions small and single-purpose.
- Use guard clauses to flatten control flow.
- Remove dead flags, unused branches, and duplicated constants.

## 5. View Lifecycle

- Bind listeners once during boot and reuse handlers.
- Pause timers/animation loops when view is hidden or inactive.
- Clear pending timers/RAF tasks during teardown or view switch.
- Keep shell-driven navigation behavior (`shell:viewchange`) consistent.

## 6. Validation

- Run `npm test` after frontend JS changes.
- Run `npm run lint:css` if CSS changed.
- Manually verify affected flows:
- assistant stream + cancel/retry
- cards search/edit/save
- pomodoro run/pause/resume/finish
- clipboard capture/search/pin/delete
