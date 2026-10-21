# Developer overview — 2026-10-21-stories

Single frontend workstream (WS-FRONT-STORIES), TypeScript + Handlebars +
SCSS, no backend. The chat page (`src/features/chats/pages/chat/`) owns the
mock story list in props and passes callbacks down; `Story` becomes
interactive (`onClick`, `isUnread`), a new reusable `StoryViewer`
(`src/components/story/storyViewer/`) renders the fullscreen overlay
(presentational: photo, 5000 ms CSS progress bar, backdrop click and
Escape-when-focused close). Adding a story goes through a hidden
`<input type="file" accept="image/*">` rendered in `chat.hbs`; the page
opens it via `querySelector` on the add-tile click and handles the picked
image in a delegated `change` events prop (object URL, prepend right after
the add tile with `isUnread: true`, reset `input.value`).

Block semantics that drive the design (verify against `src/core/Block.ts`):
hbs-embedded children are re-instantiated on every parent re-render; old
instances are dropped without `destroy()`; CDM fires only on the tree of
the first mount; `_addEvents` re-attaches `events` props after each
re-render; `refs` exist only for component helpers, never raw HTML.
Therefore: the auto-close timer lives in a private page field (cleared
before re-arm, on every close path, and in the page's `destroy()` override);
the page re-focuses the overlay in `componentDidUpdate` while a story is
open (re-render replaces the focused node and focus falls back to body);
the file input is handled by the delegated `change` event, not by a CDM
listener (which would die on the first re-render after `fetchChats`).

Style: TS — 4-space indent, single quotes, no semicolons, `.ts` imports,
Russian comments matching the file's comment density; SCSS via
`src/scss/components/` (`story.scss` grows the `_viewed` modifier, new
`story-viewer.scss` is imported from `_all.scss`). Components are registered
as Handlebars helpers through `src/components/components.ts` (StoryViewer
joins it; the vite hbs plugin picks up any `.hbs` by suffix, nested folders
included). Tests: mocha + chai + sinon + jsdom (`src/**/*.test.ts`), sinon
fake timers for the page-owned auto-close, a delegated-change stub for the
add flow. Existing suite (~203 tests) stays green.

Validation: `npm run verify` (typecheck → mocha → eslint → stylelint) and
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict`.
Manual checklist notes for the task result (not jsdom-provable): progress
bar span, fullscreen look and stacking at 375/768/1280, ring fade.

Layer reminder: pages → components → (no controllers/api touched here);
UI never imports from `api/`.
