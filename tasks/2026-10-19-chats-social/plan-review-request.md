# Plan review request — 2026-10-19-chats-social

Reviewer: independent-plan-reviewer; verdict READY_TO_FREEZE or
CHANGES_REQUIRED (max 3 rounds). Review the package directory.

Focus: (1) backend contract completeness for every frontend need (users
search response shape vs @-search UX; reaction summary shape; reply snippet
rules; chat_deleted event reach); (2) migration safety on the existing
volume (additive only, FK cascade choices for chat deletion — messages,
members, bot_runs, reactions); (3) WS backward compatibility (new event
types vs the own adapter's strict routing); (4) deletion policy (owner-only
— confirm the model has owner_id and that members lose access cleanly);
(5) two-workstream split with disjoint write-sets (backend/ vs src/) and the
A→B dependency; (6) frontend scope vs the stage-15 base (modal layer vs the
FormContainer hack; reactions on hover vs mobile long-press — pick one
mechanism that works for both); (7) test plans both sides; (8) AC/EV
binding, live P2P evidence feasibility (two sessions), honest UNAVAILABLE
policy if the stack is down.
