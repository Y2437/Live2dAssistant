# CSS Style Guide

## 1. Layering
- `src/renderer/css/theme/*.css`: only theme tokens and theme color mapping.
- `src/renderer/css/style/shell.css` + `views.css`: global layout and view infrastructure.
- `src/renderer/css/style/*.css`: feature modules (`assistant`, `cards`, `calendar`, etc.).

## 2. Token Rules
- In feature files, prefer CSS variables (`var(--c-*)`) over hard-coded colors.
- New semantic colors must be added in both `light.css` and `dark.css`.
- Avoid putting direct color values in shared layout files.

## 3. Interaction Rules
- Interactive controls must define:
  - `:hover`
  - `:active` (if clickable)
  - `:focus-visible` (keyboard accessibility)
- Focus ring should use theme token `var(--c-focus)` or module-level alias.

## 4. Naming and Scope
- Keep BEM-like naming: `block__element--modifier`.
- Module styles should stay inside their own prefix (`.assistant-*`, `.cards-*`, etc.).
- Do not cross-write styles to another module unless it is in theme mapping.

## 5. Lint Workflow
- Check CSS: `npm run lint:css`
- Auto-fix style issues: `npm run lint:css:fix`

Run lint before commit to keep style consistency across all CSS files.
