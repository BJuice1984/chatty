# Plan review request — 2026-11-01-settings

Independent plan review is requested for the S2 package
`tasks/2026-11-01-settings/` (base feature/2026-11-01-contacts @
d1ce06a — the open PR line; the chat-leave run just completed on it).

## What to review

- `plan.manifest.json` — 4 requirements, 4 workstreams (backend ->
  theme; logic after backend; UI after theme+logic), write ownership,
  budgets, gates
- `plan.md` — the operator scope, the 9-point API contract, the waves
- `acceptance-criteria.md` — the AC table + details
- `developer-overview.md` — the map and risks

## Review focus

1. Contract soundness vs the live code: the auth cookie/csrf/origin
   idioms in endpoints/auth.py; token_version mechanics in
   core/security.py + core/deps.py (does logout-all actually
   invalidate issued access tokens? the plan DEMANDS a real 401-after
   pin — verify the mechanism exists or the plan must say what to
   build); refresh-token revocation surface in services/auth.py; the
   rejoin route order vs int routes; files usage repository shape.
2. The receipts gate semantics: history skipping mark_read based on
   the RECIPIENT's flag — trace MessageService.history (the inline
   mark_read) and unread_counts to confirm the peer-facing behavior is
   what the AC pins.
3. The name-fallback sweep: UserSearchItem.from_user, ContactResponse
   (schemas/contact.py from_parts), to_member_brief — display_name or
   email-local-part; any other name surface missed (DM title creation
   in create_dm uses the email local part — should it use display_name
   now? plan says titles improve via the builders; create_dm builds
   the title at creation — flag if inconsistent).
4. Theme wave feasibility: variable.scss token inventory (are all
   tokens colors or also metrics? metrics must NOT become runtime
   vars); the sweep file list vs the actual scss inventory (fonts.scss
   and libs deliberately excluded — complete?); stylelint
   comment-free + selector patterns; the grep gate wording.
5. Settings page structure: profile.hbs current layout (left groups +
   right profile-changing container) vs the six-section navigation;
   ProfileSettingsItem props; the Account form replacing the legacy
   six-input form (email/login read-only — check the Form component
   contract supports read-only rows or the plan needs a nuance).
6. Ownership/disjointness: WS-FE-THEME does not depend on the backend
   (correct?); message.ts/.hbs in the UI wave for the autoDownload
   gate; login.scss in the UI wave (settings sections styling) —
   justified? Write-set gaps (e.g. does the profile form need
   components/form changes? validators?).
7. Missing acceptance vs the operator ask; non-goals sanity; budgets
   (4 workstreams, 32k each, 130k total).

## Verdict

Return `READY_TO_FREEZE`, `BLOCKED` with findings, or clarification
questions. Budget: 2 rounds. After a READY_TO_FREEZE verdict the cycle
runs autonomously per the operator's standing instruction.
