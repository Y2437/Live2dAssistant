# Unit Test Checklist

## Scope and Priority

- Confirm target module and exported API list.
- Confirm highest-risk logic is covered first:
- input validation
- state mutation
- persistence
- error propagation

## Case Design

- Add at least one success case per exported behavior.
- Add invalid input cases for required fields and enum/range boundaries.
- Add not-found / empty-state cases where applicable.
- Add idempotency or duplicate-handling cases for store-like modules.

## Async and Error Assertions

- Use `await assert.rejects(...)` for async functions.
- Ensure error message contains stable actionable text.
- Avoid false positives from un-awaited promises.

## Determinism

- Use temporary directories/files; avoid shared paths.
- Clean test artifacts in `finally`.
- Avoid assertions on exact timestamps unless clock is controlled.
- Avoid external network unless explicitly testing network utility behavior.

## Mocking Strategy

- Mock only process boundaries:
- filesystem path isolation
- clipboard/nativeImage adapters
- local HTTP server for request helper tests
- Keep mock behavior minimal and explicit.

## Quality Gate

- Run:
```bash
npm run test:unit
npm test
```
- Ensure `npm test` still includes existing auto checks.
- Ensure test names describe behavior, not implementation.
- Ensure each new test file maps to a clear module responsibility.
