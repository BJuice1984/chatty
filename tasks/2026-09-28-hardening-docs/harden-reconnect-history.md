# Reconnect and history evidence checklist

Record source revision, plan digest, browser, chat id, command/manual steps and result.

| Case | Required observation | Result |
| --- | --- | --- |
| HARDEN-DISCONNECT | Disconnect is visible and no stale listener remains. | PASS / FAIL / UNAVAILABLE |
| HARDEN-RECONNECT | Backoff reconnects once per attempt and does not duplicate subscriptions/messages. | PASS / FAIL / UNAVAILABLE |
| HARDEN-CLOSE | Explicit close prevents reconnect and removes handlers. | PASS / FAIL |
| HARDEN-HISTORY | Scroll/load-more uses `before_id`/limit and preserves order without duplicates. | PASS / FAIL / UNAVAILABLE |
| HARDEN-ERROR | Transport/history error is recoverable and text-only. | PASS / FAIL / UNAVAILABLE |
