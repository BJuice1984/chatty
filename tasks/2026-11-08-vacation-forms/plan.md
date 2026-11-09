# Plan — 2026-11-08-vacation-forms

Wave-sequential S2 execution on branch `feature/2026-11-08-vacation-forms`
stacked on `feature/2026-11-08-vacation-skill` @ 15b999a (D-F-4). Two
workstreams, one owner each, reviewer independent — the pattern of the
parent run.

## WS-BE-FORMS-A — deterministic core

1. **Templates** (`backend/app/vacations/templates/`): derive the three
   sanitized RTF templates from the read-only originals in
   tasks/RAG-docs/. Encoding profile (byte-verified, D-F-18): r7-office
   `{\rtf1\ansi\ansicpg0}`, every character a `\uNNNN*` escape, zero
   \'hh bytes — requisites are searched as fully-escaped runs and
   replaced with {{org_name}} / {{addressee}}; the `{\info}` metadata
   group is REMOVED entirely (its author carries a third real name and
   a legal-DB vendor marker — D-F-10/F-R1-2); the «\_\_.\_\_ 202\_\_ г.»
   cluster collapses to «{{start_date}} {{year}} г.» (start_date =
   DD.MM — probe showed a full date duplicates the year); underscore
   runs (`\u95*` clusters split by format groups) mapped positionally;
   подпись keeps its underscores; «календарных дней» literals →
   {{days_word}} (full phrase, D-F-9). Privacy pin: no real-requisite
   bytes anywhere in the repo (the marker list lives only in local
   work/ evidence; committed tests use fictional analogues).
2. **Registry + renderer** (`backend/app/vacations/forms/`):
   forms/__init__.py, forms/registry.py (FormSpec: id, template name,
   required tokens, filename title; load_template()), forms/rtf.py
   (escape_rtf_text, fill, template_tokens; ValueError on key-set
   mismatch or leftover `{{`). Pure stdlib, no new dependencies.
3. **Config**: vacations/config.py gains org_name/addressee_name
   (CHATTY_VACATION_ORG_NAME / CHATTY_VACATION_ADDRESSEE_NAME, '' default)
   + .env.example; core/config untouched.
4. **Data**: migration 016_vacation_forms.py (payload column, batch_alter,
   down_revision '015_vacations'); models/assistant_dialog_state.py gains
   payload; VacationPerson.position (service.py — first non-null row);
   store.py payload-aware accessors (backward compatible).
5. **Tests**: unit test_rtf.py, test_forms_registry.py (token sets ==
   registry == template), test_lookup position pin, test_store payload,
   integration test_migration_016_forms_segment.py (roundtrip per the
   011/015 template).

## WS-BE-FORMS-B — dialog flow and delivery (dependsOn A)

1. **Intent** (intent.py): classify() gains form_vacation / form_transfer
   / form_unpaid checked BEFORE schedule/vacation; keywords are exact
   word forms at word boundaries (no prefix/stem matching — «Как
   оформить отпуск?» stays vacation, parent pin); unpaid triggers are
   corroborated compound phrases («свой счёт», «за свой счёт», «без
   сохранения зарплаты/заработной платы», «без содержания» + vacation
   context) — a bare «счёт» never triggers; «нужен/хочу отпуск» without
   a заявление keyword stays vacation; «заявление на увольнение» matches
   NO form kind (D-F-15/D-F-19); VacationSkill.handle skips form kinds
   explicitly (no offer hijack).
2. **Surname helper** (vacations/surname_flow.py, D-F-13): extract the
   parent skill's ask/validate/persist loop; both skills call it; parent
   behavior pinned by its existing tests (no contract change).
3. **Wizard** (vacations/forms/skill.py): VacationFormsSkill(session,
   files).handle(content, user_id) → FormsOutcome(reply,
   passthrough_question, attachment) — the three state machines of
   specification.md over assistant_dialog_state with a CLOSED step
   dictionary `form:<kind>:<step>` (longest 27 chars; a unit pin walks
   every declared step and refuses > 32 — D-F-11) + payload JSON,
   deterministic date/number parser (dd.mm.yyyy / dd.mm / «с … на …
   дней», days 1..365, 2 attempts), cancel words, TTL, summary confirm,
   requisites-config refusal, должность fallback question when the
   график row lacks it (D-F-2), different-kind form intent during an
   active wizard → restart with the new kind, payload cleared (D-F-19).
4. **Seam + delivery** (services/bot.py, api/v1/endpoints/bot.py):
   endpoint constructs FileService(db, get_object_storage(settings,
   request.app.state), settings) and passes it into BotService (optional
   param, None default keeps old tests green); _execute calls
   FormsSkill FIRST, then the parent VacationSkill; an attachment
   outcome uploads via FileService (owner = bot user — already an active
   member) and posts MessageCreate(content, file_id), run.attachment_file_id
   set; files=None with an attachment → fail('form_storage_unavailable');
   upload exception → fail('form_storage_failed') (durable retry
   regenerates).
5. **Tests**: integration test_vacation_forms_flow.py — the 13 scenarios
   of acceptance-criteria.md AC-WIZARD/AC-DELIVER with a FakeStorage
   seam (assert uploaded bytes contain the escaped Cyrillic values and
   the right filename; message.file_id; run succeeded) + parent-skill
   regression («Хочу в отпуск» still offers, form intents don't).
6. **Runbook + process**: docs/deployment/vacation-forms.md (env vars,
   placeholder contract, template update flow, verification, rollback,
   privacy warnings); progress_log entry; D-11 gate; ownership audit;
   commits per D-F-14.

## Evidence

- EV-1 — wave A gates: full backend gate output + the new unit/integration
  tests green (base = parent-run numbers 392 + 4 known ingestion
  failures, re-measured at launch).
- EV-2 — wave B gates + the forms flow integration suite green.
- EV-3 — real-file control (controller, local): real env requisites,
  real график (scratch sqlite via ingest CLI --db), generate all three
  forms for one real person, open each via Word COM, extract text and
  cross-check the filled values; artifacts ONLY in
  work/2026-11-08-vacation-forms/evidence/real-forms/.
- EV-4 — deferred live smoke (operator, raised stack): dialogs of
  AC-LIVE2; receipt template + checklist in
  work/…/evidence/live/README.md; final audit BLOCKED until filed.

## Risks

- RTF corruption by token insertion → largely RETIRED by the pre-freeze
  feasibility probe (D-F-18): a template derived by exactly this surgery
  was filled and opened in Word with correct values; residual risk
  concentrates in the two remaining forms' blank mapping — EV-3 opens
  every REAL-filled form in Word; the renderer refuses unknown states
  instead of guessing.
- Metadata leakage ({\info} author of the originals) → the derivation
  removes the whole group; structural pin `no \info in templates` +
  the controller's local-marker grep (D-F-10/D-F-16).
- Stacked-branch rework cascade (parent PR amends) → mitigation: parent
  run is frozen/accepted (attempt 2), only its EV-4 is pending; rebase
  documented in D-F-4.
- Classifier regressions on the parent flow → mitigation: parent
  intent/skill tests stay in the suite untouched; new branches only add
  kinds ahead of the existing ones; token-exact keyword matching keeps
  «Как оформить отпуск?» in vacation (F-R1-4).
