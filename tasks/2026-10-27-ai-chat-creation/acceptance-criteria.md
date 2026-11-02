# Acceptance criteria — 2026-10-27-ai-chat-creation

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-FE-CONTRACT` | `REQ-FE-CONTRACT` | `EV-FE-1` | `CreateChatData` (`src/utils/types.ts`) gains `is_ai?: boolean`; `ChatsPort.createChat` accepts it additively; the own adapter includes `is_ai` in the `POST /chats` payload when set and omits it otherwise (mocha-pinned on the request shape); `ChatsController.create` forwards the field to `createChat`; title-only call sites keep working unchanged. |
| `AC-FE-FLOWS` | `REQ-FE-CREATE-FORM`, `REQ-FE-AI-TILE`, `REQ-FE-ASSISTANT-EMPTY` | `EV-FE-1` | (A) The create form shows an 'AI-ассистент' checkbox (sibling of the Form in ChatListCreate; read via `refs.create` querySelector — value serialization never reaches the page); checked sends `is_ai: true` with the title, unchecked behaves exactly as before (mocha-pinned). (B) A one-click 'Чат с AI' Button (`type='button'`) inside ChatListCreate calls `ChatsController.create({title: AI_CHAT_TITLE, is_ai: true})` via the `onAiChatClick` prop (mocha-pinned on the controller spy). (C) The assistant page with zero is_ai chats renders the Russian empty-state with a 'Создать чат с ассистентом' button wired to `AiAssistantController.createAiChat` (own `AiAssistantPort.createChat`, refresh via `loadChats`, zero imports from features/chats — guard-green); with existing is_ai chats the page renders as today (mocha-pinned). |
| `AC-PROCESS` | `REQ-FE-CONTRACT`, `REQ-FE-CREATE-FORM`, `REQ-FE-AI-TILE`, `REQ-FE-ASSISTANT-EMPTY`, `REQ-DOCS` | `EV-FE-1` | `npm run verify` green with grown test counts (378 baseline) and `guard-architecture --all --strict` zero violations; NEXT.md feature record + progress-log entry on top; no file outside the manifest write-sets changes; no backend file touched. |

## Details

### AC-FE-CONTRACT — additive widening

The port literal comment ("литералы порта в тестах обновляются вместе с
контрактом") applies: test `makePort` fakes add the widened signature without
breaking — the field is optional, existing literals remain valid. The adapter
payload is pinned with the fake-XHR request-body assertions already used in
`api.test.ts`.

### AC-FE-FLOWS — three entries, two controller paths, one constant

Entries A and B converge on `ChatsController.create`; entry C uses
`AiAssistantController.createAiChat` over the ai-assistant feature's OWN port
(the guard boundary — zero features/chats imports in ai-assistant). The
components stay presenter-level (checkbox state read in the page handler,
tile/empty-state buttons receive callbacks). The default title constant
`AI_CHAT_TITLE = 'AI ассистент'` lives in `src/utils/constants.ts` and is
imported downward by both features.

### AC-PROCESS — gates and bookkeeping

`EV-FE-1` is the verify + guard output. A manual UI smoke (checkbox → badge
✦AI in the list → message → bot answer; tile one-click; assistant empty →
button) is a NOTE against the live stack, not a gate.
