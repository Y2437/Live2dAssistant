# Backend JS Performance Checklist

## Hot Path Review

- Check repeated object allocations inside request loops.
- Check repeated `new Set(...)` or `new Map(...)` per tool invocation.
- Check repeated `JSON.parse` or `JSON.stringify` in stream/update loops.
- Check unnecessary full-array copies (`[...items]`) on high-frequency paths.

## I/O Review

- Check per-item disk writes that can be batched safely.
- Check large log-file full reads that can be cached or incrementally scanned.
- Check JSON normalization that re-sorts full datasets on every write.
- Check duplicated reads of the same file in one request lifecycle.

## Data Structure Review

- Prefer single-pass loops over multiple `filter/map` passes for large lists.
- Prefer indexed lookup maps for id/fingerprint lookups.
- Avoid rebuilding indexes unless source data changes.
- Use lexical compare for normalized date strings (`YYYY-MM-DD`).

## Safety Review

- Keep cancellation signals threaded through async operations.
- Keep existing public contract shape unchanged unless migration is explicit.
- Ensure exceptions preserve actionable context (`status`, key ids, failing op).
- Ensure performance changes do not silently drop records.

## Validation

```bash
npm test
node --check src/main/ipc/ipcRegister.js
node --check src/main/ipc/agentService.js
```
