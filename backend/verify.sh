#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python_bin="${PYTHON_BIN:-python3}"
cd "${backend_dir}"

export PYTHONDONTWRITEBYTECODE=1
PYTHONPATH=. "${python_bin}" -m pytest -q tests
PYTHONPATH=. "${python_bin}" -m alembic heads

echo "backend verify: PASS"
