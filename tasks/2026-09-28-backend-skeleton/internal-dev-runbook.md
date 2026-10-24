# Internal development deployment runbook

This runbook is an execution-time checklist for the first backend package. It does not expose the service publicly and does not verify Ollama; model verification is a later package.

## Before deployment

- Record the internal hostname/IP for the API host and the allowed frontend origin.
- Prepare secrets outside Git and create a target `.env` from `backend/.env.example`.
- Confirm the target host has Docker Engine and Compose, and that PostgreSQL/MinIO ports are private or container-only.
- Confirm the operator has a rollback point and a database backup location.

## Deployment gate

```text
docker compose config --quiet
docker compose up -d --build
curl -f http://<internal-api-host>/health
curl -f http://<internal-api-host>/ready
backend/verify.sh
```

Record container health, migration/seed result, API health/readiness, auth smoke, source revision, plan digest and any unavailable target dependency. `UNAVAILABLE` is not `PASS`.

## Explicitly deferred

Ollama reachability, model names, model downloads, embedding dimensions and RAG/bot behavior are not acceptance gates for this package.
