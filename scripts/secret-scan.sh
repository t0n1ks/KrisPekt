#!/bin/sh
# Scans the commits reachable from a revision for secrets, and exits non-zero on any finding or
# if the scan could not run: a scan that did not happen must never look like a clean one.
# Usage: sh scripts/secret-scan.sh [revision]   (default: HEAD)
set -eu

GITLEAKS_MODULE=github.com/zricethezav/gitleaks/v8
GITLEAKS_VERSION=v8.30.1

revision=${1:-HEAD}
cd "$(git rev-parse --show-toplevel)"

if ! command -v go >/dev/null 2>&1; then
  echo "secret-scan: Go is not installed, so the scan cannot run." >&2
  exit 2
fi

# No pipe after this command: a pipe would report the exit code of its last part, not this one.
go run "$GITLEAKS_MODULE@$GITLEAKS_VERSION" git \
  --config .gitleaks.toml \
  --log-opts="$revision" \
  --no-banner \
  --redact \
  .

echo "secret-scan: clean ($revision)"
