# Internal backend deployment

This package deploys only the Chatty API foundation, PostgreSQL and an
S3-compatible object store on a private Docker network. The Compose service is
kept under the stable `minio` name for later S3 clients, but uses the
Apache-2.0 RustFS image because the former MinIO Community container is not
available from the registries used by this host. The frontend origin is
configured explicitly and no service is intended to be exposed directly to the
public Internet. Ollama and local-model verification belong to a later package.

## Prepare the host

1. Install Docker Engine with Compose v2 on the internal host.
2. Copy `backend/.env.example` to an operator-managed environment file and set
   random values for `POSTGRES_PASSWORD`, `CHATTY_JWT_SECRET`, the
   `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` RustFS credentials and the optional
   seed-admin password. Keep that file outside Git and limit it to the
   deployment operator.
3. Set `CHATTY_ALLOWED_ORIGINS` to the exact internal frontend origin and set
   `API_BIND_IP`/`MINIO_BIND_IP` to a private interface when another internal
   host must reach the services. Do not bind them to a public interface.
4. Confirm a database backup location and a rollback revision before starting.

## Start and verify

From the repository root, with the deployment environment loaded:

```bash
docker compose config --quiet
docker compose up -d --build
curl -f http://<internal-api-host>:8000/health
curl -f http://<internal-api-host>:8000/ready
curl -f http://<internal-storage-host>:9000/health
backend/verify.sh
```

The API container runs `alembic upgrade head`, then the optional environment
admin seed, before starting Uvicorn. The `minio-volume-init` helper grants the
RustFS non-root UID access to the named data volume before the object store
starts. The first auth smoke should register or log in through `/api/v1/auth`,
retain the HttpOnly access/refresh cookies, send the `chatty_csrf` value in
`X-CSRF-Token` for refresh/logout, and confirm that logout removes access to
`/api/v1/auth/me`.

If Docker, PostgreSQL, RustFS or the target internal network is unavailable,
record that dependency as `UNAVAILABLE`; never describe it as a passing live
deployment check. Deterministic Python tests and Compose syntax checks remain
separate evidence.

## Rollback

Record the deployed Git revision and plan digest with the deployment receipt.
To roll back, stop the stack, restore the previously approved revision and
database backup, then rerun the health/readiness and auth smoke checks. Do not
delete the named volumes without a verified backup.
