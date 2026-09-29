# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-RAG-1` | `REQ-BE-RAG` | `EV-RAG-1` | Fixed `.docx`, `.doc`, text-PDF and `.xlsx` fixtures reach deterministic ready/failed states, including bounded `.doc` timeout/failure. |
| `AC-RAG-2` | `REQ-BE-RAG` | `EV-RAG-2` | Authorized top-k retrieval is chat-scoped, returns traceable `file_id` metadata, and never searches failed/partial documents as ready. |

## Evidence contract

`EV-RAG-1` contains parser/unit receipts independent of Ollama. `EV-RAG-2` contains retrieval/security tests and the manual checklist. Missing Ollama, LibreOffice or pgvector is recorded as `UNAVAILABLE` with command and dependency, never PASS.
