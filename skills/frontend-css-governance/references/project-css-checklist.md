# Project CSS Checklist

## 1. Layer Map
- `src/renderer/css/theme/*.css`
- Own theme tokens and theme color mapping only.
- `src/renderer/css/style/shell.css` and `views.css`
- Own app shell layout and shared structure.
- `src/renderer/css/style/*.css`
- Own feature module styles (`assistant`, `cards`, `calendar`, `clipboard`, `pomodoro`, `settings`).

## 2. Token Discipline
- Prefer `var(--c-*)` tokens in feature files.
- Avoid hard-coded colors in module CSS unless strictly necessary.
- When creating semantic colors, add matching tokens in both light and dark theme files.

## 3. Interaction Discipline
- For clickable controls, define `:hover`, `:active`, `:focus-visible`.
- Use `outline` for keyboard focus and keep it clearly visible.
- Keep transitions short and consistent (prefer existing `--ease-out` and 120ms/160ms rhythm).

## 4. Consistency Discipline
- Keep selector naming scoped by module prefix.
- Avoid duplicate selectors in theme mapping blocks.
- Prefer `overflow-wrap: anywhere` over deprecated `word-break: break-word`.

## 5. Verification Commands
```bash
npm run lint:css:fix
npm run lint:css
```

## 6. Refactor Order (Large Changes)
1. Reconcile theme tokens first.
2. Normalize module interaction states.
3. Run lint auto-fix.
4. Re-check any manually adjusted selectors.
