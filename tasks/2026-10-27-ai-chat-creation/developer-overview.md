# Developer overview — 2026-10-27-ai-chat-creation

One workstream: WS-FE-AI-CHAT (TypeScript + Handlebars + mocha). Base
dev@353db1a; branch `feature/2026-10-27-ai-chat-creation`. Revision 2: plan
review incorporated — guard-clean route for entry C (F1), executable
checkbox/tile mechanisms (F2/F5), DTO home + method names (F3), shared
constant in utils (F4).

The gap: `POST /chats {title, is_ai}` and the bot auto-trigger
(`controller.sendMessage` → `POST /chats/{id}/bot/runs` for `is_ai` chats,
controller.ts:345-352) already work; `/assistant` maps
`chats.filter(is_ai)` (ai-assistant/controller.ts:28-44) and already HAS an
empty-state branch (assistant.hbs:4-6). Nothing on the frontend can produce
an `is_ai` chat.

Map:
- Contract: `CreateChatData` (src/utils/types.ts:64-67) gains
  `is_ai?: boolean`; ports.ts `createChat(data: CreateChatData)` (the PORT
  method is `createChat`, the CONTROLLER method is `create`); own.ts
  `createChat` posts `is_ai` when set; controller.create forwards.
- Entry A: the Form component's inner markup is fixed (form.hbs — no slot)
  and `_serializeForm` reads `element.value` (`'on'` for a checkbox
  regardless of checked) — so the checkbox lives as a SIBLING of
  `{{{ Form }}}` inside ChatListCreate's `<li>`, and `handleSubmitClick`
  (which receives only the serialized title) reads it at submit time via
  `this.refs.create` (the existing precedent, chat.ts:344) →
  `.querySelector('input[name="is_ai"]')?.checked`. emptyValidator applies
  to the title input only (form.ts iterates props.inputs).
- Entry B: a `Button` with `type='button'` (NOT a submit — it would submit
  the form) inside the same `<li>`, callback prop `onAiChatClick` from the
  page → `ChatsController.create({title: AI_CHAT_TITLE, is_ai: true})`.
  `AI_CHAT_TITLE = 'AI ассистент'` lives in the existing
  `src/utils/constants.ts` (append the export — the file already holds validation-message constants and is imported by main.ts/chat.ts) — importable by both features (a value import
  from features/chats into ai-assistant is a guard blocker).
- Entry C (guard-clean): ai-assistant widens its OWN port —
  `AiAssistantPort.createChat({title; is_ai?})` implemented in its own
  adapter (ai-assistant/api/own.ts already calls GET /chats) — and
  `AiAssistantController.createAiChat` refreshes via the existing
  `loadChats()`; the page wires the empty-state button to it. ZERO imports
  from features/chats anywhere in ai-assistant; `guard --all --strict` is
  the load-bearing gate for this route.
- Styles: `src/scss/components/chat-list-create.scss` for the checkbox row
  and the tile (no new tokens).
- Tests: api.test.ts (chats payload), chats.test.ts (forward + constant),
  chatListCreate.test.ts (NEW file — searchBar.test.ts is the component
  test precedent), chat.test.ts (A/B wiring), ai-assistant
  api.test.ts + assistant.test.ts (C).

Execution: single worker, evidence `EV-FE-1` (verify + guard), PR to `dev`.
