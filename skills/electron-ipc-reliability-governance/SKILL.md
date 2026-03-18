---
name: electron-ipc-reliability-governance
description: Harden Electron IPC reliability, contract consistency, and runtime safety in this project. Use when editing src/main/ipc/**/*.js, src/main/preload.js, stream/cancel handlers, IPC payload validation logic, or when reviewing invoke/handle compatibility and error propagation.
---

# Electron Ipc Reliability Governance

Apply a strict IPC workflow so request/response behavior remains predictable, cancellable, and backward-compatible.

## Workflow

1. Map the IPC surface before editing:
- handlers in `src/main/ipc/ipcRegisterHandlers.js`
- exposed invokes in `src/main/preload.js`
- backend logic in `src/main/ipc/*.js`
2. Validate contracts first:
- check channel existence (`invoke` has `ipcMain.handle`)
- verify payload validation and required fields
- verify returned shape stays stable
3. Harden runtime behavior:
- ensure async handlers throw actionable errors
- ensure stream handlers send terminal states (`complete`/`error`/`canceled`)
- ensure cancel endpoints actually abort in-flight tasks
4. Keep compatibility:
- do not rename channels unless all callers are migrated
- keep optional fields optional and defaulted safely
5. Validate:
```bash
npm test
node --check src/main/ipc/ipcRegisterHandlers.js
node --check src/main/preload.js
```
6. Summarize:
- channel-level changes
- compatibility impact
- residual integration risk

## Rules

- Prefer explicit payload normalization over implicit coercion.
- Return deterministic error messages for invalid input.
- Keep per-request state isolated; avoid shared mutable globals unless guarded.
- Remove stale stream controllers and listeners in `finally`.
- Preserve existing event channel names (for example `app:*` and stream `*:event`).

## References

- Read `references/ipc-reliability-checklist.md` for detailed review points.
