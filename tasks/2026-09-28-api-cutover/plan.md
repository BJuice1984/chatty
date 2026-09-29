# Implementation plan

1. Read the accepted auth/chats/profile feature ports and backend HTTP/WS/file contracts.
2. Implement Practicum and own adapters behind each feature port, with explicit mode selection and normalized errors.
3. Implement the WebSocket gateway with clean close and origin/CSRF inputs, then wire module registration and routes in the composition root.
4. Add the shared message renderer with safe attachment URL handling.
5. Run deterministic verify/build and the three bounded smoke flows: Practicum login, own auth/chat/file, and clean WS close. Only after both modes pass may the package be accepted.
