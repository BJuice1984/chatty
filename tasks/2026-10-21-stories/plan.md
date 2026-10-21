# Plan — 2026-10-21-stories (stage: stories UI, client-only mocks)

One workstream: WS-FRONT-STORIES. Base is the head of
`feature/2026-10-19-chats-social` (e3ff881) — chats-social is not merged to
dev yet and this plan touches the same chat-page files, so the branch is
stacked; the PR targets `dev` after chats-social lands. Contingency: rebase
`feature/2026-10-21-stories` onto `dev` once chats-social is merged; do not
open the PR before that merge.

Core Block semantics this plan builds on (verified at review):
hbs-embedded children are re-instantiated on every parent re-render, old
instances are dropped without `destroy()`, and CDM fires only on the tree of
the first mount — so the page, not the viewer, owns the timer, the focus and
the file input; `events` props are re-attached by `_addEvents` after each
re-render, so delegated page-level `click`/`change` survive re-renders.

## WS-FRONT-STORIES

1. `src/components/story/story.ts` + `story.hbs`: props gain `id?`,
   `isUnread?` (default true) and `onClick?`; a `click` event on
   `chat-story__container` calls `onClick`; `story.hbs` renders the
   `chat-story__container_viewed` modifier when the story is not unread.
   The add tile keeps `chat-story__container_type_add-story` and uses the
   same onClick path.
2. New `src/components/story/storyViewer/storyViewer.ts` + `storyViewer.hbs`:
   PRESENTATIONAL fullscreen overlay (`chat-story-viewer`, fixed,
   `tabindex="-1"`, outline none) with the story photo centered and a top
   CSS progress bar animated for `STORY_VIEW_DURATION_MS = 5000` (animation
   restarts on re-mount; acceptable at this stage). No timer inside: close
   intent travels through props — a root-delegated `click` event resolves
   backdrop clicks (same delegation as `Modal`) and calls `onClose`; the
   root `keydown` handles Escape when the overlay holds focus. The overlay
   never holds state.
3. `src/components/components.ts`: export `StoryViewer` (registration as a
   Handlebars helper happens through the existing loop in `main.ts`).
4. `src/features/chats/pages/chat/chat.ts` — the owner of all mutable story
   behaviour:
   - the mock `stories` array becomes typed items
     `{id, owner, src, alt, isUnread}` (add tile first, marked `type: 'add'`);
   - `viewerStoryId?: string` prop selects the story shown in the viewer;
   - `onStoryOpen(id)`: setProps `viewerStoryId`; (re)arm the auto-close
     `setTimeout(STORY_VIEW_DURATION_MS)` stored in a private field
     (`clearTimeout` first — no double timers), then focus the overlay;
   - close handler (shared by timeout, backdrop and Escape paths):
     `clearTimeout`, setProps `viewerStoryId: null` and mark the story
     viewed in one `setProps`;
   - `componentDidUpdate`: if a story is open, re-focus the overlay in the
     next frame, guarding the frame callback (story still open, overlay
     found — a close inside the frame must not focus a dead overlay);
     re-render replaces the focused node with a fresh one and focus falls
     back to body — without this, Escape breaks after any re-render, e.g.
     an incoming chat update;
   - override `destroy()`: `clearTimeout`, then `super.destroy()`;
   - add flow: the add tile's `onClick` runs
     `this.element?.querySelector('input[type="file"]')?.click()` (no ref —
     refs only exist for component helpers); a hidden
     `<input type="file" accept="image/*">` is rendered in `chat.hbs`; the
     page constructor passes a delegated `change` events prop (change
     bubbles; `_addEvents` re-attaches it after every re-render — a CDM
     listener would die on the first re-render): if `event.target` is the
     file input, take `files[0]`, reset `input.value` (same-file re-pick
     works) and prepend `{id: nanoid(8), owner: 'You story',
     src: URL.createObjectURL(file), isUnread: true}` right after the add
     tile; the viewer does not open.
5. `chat.hbs`: pass the new props into `Story`; mount `StoryViewer` as a
   direct child of the root `<section class="chat">` (after the two
   containers — not inside `chat__container-users`, which the mobile
   `chat_pane-open` subtree hides); add the hidden file input.
6. SCSS: `story.scss` — `_viewed` modifier (muted ring replacing the
   gradient, hover behaviour unchanged); new `story-viewer.scss` (overlay,
   photo fit `object-fit: contain`, progress bar, close affordance, z-index
   above the app, focus outline none, 375/768/1280 tweaks) imported in
   `_all.scss`.
7. Tests:
   - `story.test.ts`: renders `viewed` modifier from `isUnread: false`;
     click on the container calls `onClick`.
   - `storyViewer.test.ts`: backdrop click calls `onClose`; Escape after
     focusing the overlay root calls `onClose`; the component holds no
     timers (no setTimeout in the component itself).
   - `chat.test.ts` (extend, fake timers): auto-close — the armed timer
     closes the viewer and marks the story viewed exactly at 5000 ms;
     manual close path clears the timer (no late fire); a re-render while
     open (setProps of an unrelated prop) does not close the viewer and the
     original timer still fires once; `onStoryFileChosen`-equivalent flow —
     the delegated change handler prepends a story with `isUnread: true`
     right after the add tile (DOM order: add tile stays first, list length
     grows by one) and resets the input value; `onStoryViewed` flips only
     the target story.
8. Docs: `docs/progress/progress_log.md` entry (controller-owned).

Manual checklist for the task result (not provable by jsdom, listed as
evidence notes, not gate claims): the progress bar visually spans the same
5 s; the overlay looks fullscreen with correct stacking at 375/768/1280;
the ring gradient fade is visible.

Verification: `npm run verify`, then
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict`.
