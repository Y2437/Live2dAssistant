---
name: frontend-css-governance
description: Audit, normalize, and govern frontend CSS for this Electron renderer project. Use when editing files in src/renderer/css, enforcing theme-token usage, fixing CSS consistency/accessibility issues, or running stylelint checks to keep styles maintainable.
---

# Frontend CSS Governance

Apply a consistent workflow for CSS changes in this project so theme behavior, interaction states, and lint quality stay stable.

## Workflow

1. Locate affected files in `src/renderer/css/theme` and `src/renderer/css/style`.
2. Keep layer boundaries strict:
- Put tokens and theme mapping in `theme/*.css`.
- Put layout/structure in `style/*.css`.
3. Replace hard-coded colors in feature CSS with semantic tokens where possible.
4. Ensure interactive elements include `:hover`, `:active` (if clickable), and `:focus-visible`.
5. Run lint and auto-fix:
```bash
npm run lint:css:fix
npm run lint:css
```
6. Summarize changed files and any residual risk.

## Project Rules

- Treat these files as source of truth:
- `docs/CSS_STYLE_GUIDE.md`
- `stylelint.config.cjs`
- `package.json` scripts `lint:css` and `lint:css:fix`
- Keep BEM-like module naming (`.module__element--modifier`) and module prefixes (`.assistant-*`, `.cards-*`, `.calendar-*`, etc.).
- When adding a new semantic color token, add it to both:
- `src/renderer/css/theme/light.css`
- `src/renderer/css/theme/dark.css`
- Do not duplicate selector blocks in theme mapping lists.

## Required Checks Before Finish

- Confirm theme compatibility for both `data-theme="light"` and `data-theme="dark"`.
- Confirm keyboard focus visibility for changed controls.
- Confirm `npm run lint:css` passes.

## References

- Read `references/project-css-checklist.md` when doing large refactors or cross-module cleanup.
