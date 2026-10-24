# RAG evidence checklist

Record source revision, plan digest, fixture hash, command, timeout and result for each row.

| Case | Required observation | Result |
| --- | --- | --- |
| RAG-DOCX | `.docx` reaches ready and chunks are persisted. | PASS / FAIL / UNAVAILABLE |
| RAG-DOC | `.doc` conversion is bounded; timeout or converter failure reaches failed. | PASS / FAIL / UNAVAILABLE |
| RAG-PDF-XLSX | Text PDF and XLSX are parsed without OCR. | PASS / FAIL / UNAVAILABLE |
| RAG-SCOPE | Member sees only authorized chat-scoped top-k results with file_id. | PASS / FAIL / UNAVAILABLE |
| RAG-OLLAMA | Configured embedding model is used; no cloud fallback. | PASS / FAIL / UNAVAILABLE |
