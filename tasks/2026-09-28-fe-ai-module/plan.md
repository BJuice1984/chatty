# Implementation plan

1. Define AI feature state and port contracts for searching, typing, result, empty and error states.
2. Implement controller/store/module and assistant page using the existing Block/Handlebars architecture.
3. Implement typing indicator and document card with text-only bot content, safe `https`/configured file URL handling and rejected schemes.
4. Add deterministic rendering tests for XSS-like HTML, `javascript:`/`data:` links, empty/error states and valid attachment URLs.
5. Run `npm run verify` and complete the bounded browser checklist against the accepted bot/adapter contract.
