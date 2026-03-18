# IPC Reliability Checklist

## Contract Consistency

- Confirm every `invoke("app:...")` has matching `ipcMain.handle("app:...")`.
- Confirm handler return types remain stable for renderer callers.
- Confirm renamed channels are migrated in preload and renderer together.

## Payload Validation

- Validate required fields at handler boundary.
- Normalize optional fields to safe defaults.
- Reject invalid enum/status values with deterministic error text.
- Avoid silently accepting malformed payloads.

## Streaming/Cancellation

- Confirm stream channels emit `status`, `content`, and terminal event.
- Confirm terminal event is exactly one of `complete`, `error`, `canceled`.
- Confirm cancel endpoint aborts the correct in-flight request id.
- Confirm controller cleanup runs in `finally` blocks.

## Error Handling

- Throw errors with enough context to debug (`requestId`, `channel`, reason).
- Preserve `AbortError` semantics for canceled requests.
- Avoid swallowing handler exceptions unless fallback behavior is intentional.

## Regression Guards

- Run project contract checks:
```bash
npm test
node --check src/main/ipc/ipcRegisterHandlers.js
node --check src/main/preload.js
```
