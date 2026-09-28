# AI UI rendering-safety checklist

Record source revision, plan digest, browser, route, input and result.

| Case | Required observation | Result |
| --- | --- | --- |
| AI-SEARCHING | Searching/typing state is visible and bounded. | PASS / FAIL / UNAVAILABLE |
| AI-EMPTY | Empty retrieval has a safe, actionable state. | PASS / FAIL / UNAVAILABLE |
| AI-ERROR | Provider/backend failure renders text-only error state. | PASS / FAIL / UNAVAILABLE |
| AI-HTML | Bot-supplied markup is rendered as text, never executable DOM. | PASS / FAIL |
| AI-URL | `javascript:`, `data:` and arbitrary origins are rejected; configured file URL is accepted. | PASS / FAIL |
| AI-FILE | Valid card preserves authorized `file_id` and uses configured download path. | PASS / FAIL / UNAVAILABLE |
