# Plan review request — 2026-10-21-avatars-stories (revision 4)

Round 1 returned REWORK (2 MAJOR, 3 MINOR, 3 NIT). Revision 2 addresses
every finding:

- PR-1 (cross-feature guard conflict): the stories module moved INSIDE
  the chats feature — `src/features/chats/stories/` (the `chats/history`
  precedent); no cross-feature imports anywhere, no composition-seam
  changes, `src/main.ts` / `src/features/index.ts` stay untouched.
- PR-2 (write-set gaps): `backend/app/repositories/chats.py` and
  `backend/app/services/chats.py` added to WS-BE-MEDIA (members
  avatar_url widening); `src/features/profile/ports.ts` added to
  WS-FE-MEDIA (`changeAvatar` narrows to `Promise<{ avatar: string }>`);
  `src/features/chats/ports.ts` is NOT changed — see PR-7.
- PR-3 (alembic quality floor): migration 007 uses `batch_alter_table`;
  the upgrade/downgrade round-trip is a manual evidence note against
  the compose PostgreSQL, not an automated gate (qualityFloor and
  acceptance criteria reworded to match what `verify:backend` proves).
- PR-4 (avatar_url population mechanism): Python properties on the
  User/Chat models picked up by from_attributes responses; hand-built
  responses pass the value explicitly.
- PR-5 (stories double-source race): the page never writes stories
  props; the ring fade is the controller's synchronous Store-slice
  patch inside markViewed, rendered through withStore.
- PR-6 (chat.hbs): removed from the WS-FE-MEDIA write-set; the plan
  states the template needs no change.
- PR-7 (chat id source): `changeChatAvatar` keeps its port signature;
  the adapter reads the clicked tile's chat id from the UI FormData
  `chatId` field (`inputFile.ts` appends it), not from selectedChat.
- PR-8 (budgets): defaultWorkstreamTokens 40000, per-task/per-run token
  caps 40000/80000, budgetPolicy maxTotalTokens 80000.

Independent plan review of `tasks/2026-10-21-avatars-stories/` (S2,
tier resolved by `agent-lifecycle tier resolve`: multiple executable
owners + browser-risk). Base revision `87b7e87` (head of
`feature/2026-10-21-stories`, stacked: chats-social and the mock
stories stage are not merged to dev yet; contingency documented in
plan.md — rebase onto dev after both land, PR after them).

Review scope (round 2 — verify the rework, then the full checklist):
- PR-1..PR-8 remediation correctness against the code (guard script
  cross-feature rule, `inputFile.ts` FormData fields, profile port
  types, chat repository members query, alembic/verify.sh reality);
- requirements ↔ acceptance criteria ↔ evidence mapping
  (specification.json rev 2, acceptance-criteria.md, plan.manifest.json
  rev 2);
- workstream write-set exactness and the BE/FE split (WS-BE-MEDIA
  writes only `backend/` files, WS-FE-MEDIA only frontend files,
  wave dependency BE → FE declared);
- access control: the only widening is `chat_id IS NULL` media for
  authenticated users; chat attachments stay participant-only;
- frontend fit: in-feature stories module, page lifecycle duties
  untouched, avatar URL conventions, Store-slice single source of truth;
- mock-stage removal completeness without breaking the existing
  297-test suite;
- budgets, orchestration caps, evidence commands sanity.

Do not implement. Return the verdict in the plugin's review report
format (READY_TO_FREEZE / REWORK / BLOCKED) with findings.

Round 2 (revision 2) verified the round-1 remediation against the code and
returned REWORK with one MAJOR, two MINOR and three NIT; revision 3 closes
them all:

- R2-1 (MAJOR): `src/features/profile/api/api.test.ts` added to the
  WS-FE-MEDIA write-set; the plan's test list now reworks the
  `changeAvatar`-unsupported case into the real contract (FormData rebuild
  `{uploaded, kind: 'user'}`, mocked `{avatar}` response).
- R2-2 (MINOR): the stale "features/stories module" wording removed from
  specification.json intent/scope and the manifest specification intent —
  all artifacts now say the stories module lives inside the chats feature.
- R2-3 (MINOR): the AppState slice is now specified unambiguously —
  `stories?: { [key: string]: unknown }[]` exactly like the `chats` slice,
  the concrete `StoryDto` type stays in `features/chats/stories/ports.ts`
  with the cast in the module slice setter; NO type imports from `features/`
  into `src/utils/Store.ts` (the guard's layer check has no type-only
  exemption).
- R2-4 (NIT): plan no longer calls `get_chat` hand-built — it keeps
  `model_validate` and inherits the avatar_url property via
  from_attributes; only `list_chats` and members pass it explicitly.
- R2-5 (NIT): the adapter synthesizes `alt` from the owner name (the
  backend feed has no alt field).
- R2-6 (NIT): `planReview.reviewedRevision` syncs to 3 with this round.

The round-2 review stated a full re-review is unnecessary after these
point fixes; round 3 is the confirm pass.

Round 3 (confirm pass over revision 3) closed R2-1/R2-3..R2-6 and left one
MINOR (PR3-1): the R2-2 fix had silently not applied (a no-op string
replace) — 'features/stories module' stayed in specification.json intent
and the manifest specification.intent while plan-review-request.md claimed
its removal. Revision 4 rewrites BOTH intent fields by assignment with one
synchronized text (the manifest intent also drops its stale round-1
wording) and raises the revision counters; a grep over the package leaves
only the legitimate plan.md mention (the "why not a separate feature"
rationale) and the finding quote in this file. Round 4 is the point
confirm over PR3-1 only, as the round-3 reviewer prescribed.
