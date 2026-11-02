# Plan — 2026-10-27-ai-chat-creation

Three explicit entries to create an AI chat (backend already supports
everything: `POST /chats {title, is_ai}`, auto bot runs via
`controller.sendMessage` for `is_ai` chats, `/assistant` over is_ai chats).
Base: `dev` @ 353db1a. Revision 2 incorporates the plan review: guard-clean
route for entry C (F1), executable checkbox/tile mechanisms (F2/F5), DTO
home and method names (F3), shared constant in utils (F4), wording (F6).

## Wave 1 — frontend (WS-FE-AI-CHAT)

1. **Contract**: `src/utils/types.ts` — `CreateChatData` gains
   `is_ai?: boolean`; `ports.ts` `createChat(data: CreateChatData)` forwards
   it; `api/own.ts` `createChat` posts `is_ai` when set (backend defaults
   false); `ChatsController.create({title; is_ai?})` → `port.createChat`.
   Existing title-only call site (`chat.ts:394`) untouched.
2. **Entry A — checkbox**: `src/components/chatListCreate/` — a raw
   `<label><input type="checkbox" name="is_ai">AI-ассистент</label>` as a
   SIBLING of the embedded `{{{ Form }}}` inside the component's `<li>`
   (the Form markup has no slot, and `_serializeForm` would read `'on'`
   regardless of checked — the page never sees form values beyond the
   serialized title). The page's `handleSubmitClick` reads the box at
   submit time via the existing `this.refs.create` →
   `.querySelector('input[name="is_ai"]')?.checked` and passes `is_ai` to
   `ChatsController.create`. Unchecked = today's behavior;
   `emptyValidator` applies to the title input only.
3. **Entry B — one-click tile**: a `Button` (`type='button'`, NOT a submit)
   rendered inside the same `<li>` next to the Form, callback prop
   `onAiChatClick` from the page →
   `ChatsController.create({title: AI_CHAT_TITLE, is_ai: true})`;
   `AI_CHAT_TITLE = 'AI ассистент'` exported from
   `src/utils/constants.ts` (EXISTING file — append the export; shared
   lower layer, importable by both features).
4. **Entry C — assistant empty-state (guard-clean route)**: the
   ai-assistant feature widens its OWN port —
   `AiAssistantPort.createChat({title; is_ai?})` implemented in its own
   adapter (it already talks to `/chats` via `fetchChats`) — and
   `AiAssistantController.createAiChat({title: AI_CHAT_TITLE, is_ai:
   true})` refreshes via the existing `loadChats()`. The assistant page
   (which has an empty-state branch today, `assistant.hbs:4-6`) gains the
   Russian hint + 'Создать чат с ассистентом' button wired to
   `createAiChat`. **Zero imports from features/chats** — a cross-feature
   runtime import is a guard blocker; the page stays inside its feature.
   With existing is_ai chats the page renders as today.
5. **Tests**: adapter payload pins (is_ai set/omitted), controller forward,
   `AI_CHAT_TITLE`, checkbox render + checked/unchecked payload (A), tile
   click → `create({is_ai:true})` (B), assistant empty-state render +
   `createAiChat` wiring + non-empty unchanged (C).
6. **Docs**: NEXT feature record + progress-log entry on top.

## Out of scope

Post-creation rename/config, personas/model selection, seeding an AI chat
for new users, bot-trigger changes, the assistant document flow.

## Evidence

`EV-FE-1` = `npm run verify` (378+ mocha) + `guard-architecture --all
--strict` zero violations (the guard gate is load-bearing for entry C's
route choice).
