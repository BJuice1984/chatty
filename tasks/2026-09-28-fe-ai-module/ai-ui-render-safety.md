# AI UI rendering-safety checklist

Record source revision, plan digest, browser, route and input in the
`EV-AI-UI-2.json` receipt (this file stays the frozen case template).

| Case | Required observation | Result |
| --- | --- | --- |
| AI-SEARCHING | Searching/typing state is visible and bounded. | PASS / FAIL / UNAVAILABLE |
| AI-EMPTY | Empty retrieval has a safe, actionable state. | PASS / FAIL / UNAVAILABLE |
| AI-ERROR | Provider/backend failure renders text-only error state. | PASS / FAIL / UNAVAILABLE |
| AI-HTML | Bot-supplied markup is rendered as text, never executable DOM. Deterministic escaping/template assertions carry the verdict; the browser observation is UNAVAILABLE without a live owned backend. | PASS / FAIL / UNAVAILABLE |
| AI-URL | `javascript:`, `data:` and arbitrary origins are rejected; configured file URL is accepted. Deterministic rejection-matrix tests carry the verdict; the browser observation is UNAVAILABLE without a live owned backend. | PASS / FAIL / UNAVAILABLE |
| AI-FILE | Valid card preserves authorized `file_id` and uses configured download path. | PASS / FAIL / UNAVAILABLE |
