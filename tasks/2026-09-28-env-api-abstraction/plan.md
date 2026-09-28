# Implementation plan

1. Inspect the current HTTP, WebSocket, avatar and message-controller call sites and record the existing contracts in the worker evidence.
2. Add typed, validated environment helpers for `practicum` and `own` modes. Keep public configuration separate from secrets and use safe URL joining.
3. Update `HTTPTransport`, `MessagesController`, `ApiError` and avatar templates to consume the boundary. Preserve the controller's current public behavior as a compatibility adapter.
4. Add focused unit tests for mode selection, URL joining, CSRF forwarding, WS origin input, error normalization and missing configuration.
5. Run the deterministic and bounded manual gates. Report external Practicum availability separately from local test results.

The worker must stop after this package's write set is complete and produce one evidence receipt per acceptance criterion. Later stages consume the environment contract; they do not rely on undocumented URL conventions.
