# CSS Style Guide

## 1. Layering
- `src/renderer/css/theme/*.css`: only theme tokens and theme color mapping.
- `src/renderer/css/style/shell.css` + `views.css`: global shell layout and shared view infrastructure.
- `src/renderer/css/style/*.css`: feature modules such as `assistant`, `cards`, `pomodoro`, `clipboard`, `calendar`, `settings`, and standalone page support.

## 2. Current stylesheet set
- Theme: `light.css`, `dark.css`
- Layout: `shell.css`, `views.css`, `standalone.css`
- Feature modules: `assistant.css`, `cards.css`, `pomodoro.css`, `clipboard.css`, `calendar.css`, `settings.css`

## 3. Token Rules
- In feature files, prefer CSS variables (`var(--c-*)`) over hard-coded colors.
- New semantic colors must be added in both `light.css` and `dark.css`.
- Avoid putting direct color values in shared layout files.

## 4. Interaction Rules
- Interactive controls must define:
  - `:hover`
  - `:active` (if clickable)
  - `:focus-visible` (keyboard accessibility)
- Focus ring should use theme token `var(--c-focus)` or a module-level alias derived from theme tokens.

## 5. Naming and Scope
- Keep BEM-like naming where practical: `block__element--modifier`.
- Module styles should stay inside their own prefix (`.assistant-*`, `.cards-*`, `.calendar-*`, `.clipboard-*`, `.pomo-*`, etc.).
- Do not cross-write styles to another module unless it belongs to shared layout/theme mapping.
- If an existing module already uses a stable prefix pattern, extend that pattern instead of inventing a new one.

## 6. Lint Workflow
- Check CSS: `npm run lint:css`
- Auto-fix style issues: `npm run lint:css:fix`

Run lint before commit to keep style consistency across all CSS files.
