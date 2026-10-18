#!/usr/bin/env bash
# Daily Postgres backup -> Cloudflare R2.  Location on VM: ~/deploy/backup.sh
# Credentials come from ~/deploy/backup.env (chmod 600), never from this file.
set -euo pipefail
cd "$(dirname "$0")"

set -a
. ./backup.env
set +a

# R2 rejects the newer default checksum headers of aws-cli v2.23+.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_DEFAULT_REGION=auto

ts=$(date -u +%Y%m%dT%H%M%SZ)
file="/tmp/anki-${ts}.dump"
trap 'rm -f "$file"' EXIT

docker compose exec -T postgres pg_dump -U anki -d anki_sprache -Fc > "$file"
[ -s "$file" ] || { echo "backup failed: dump is empty" >&2; exit 1; }

docker run --rm \
  -v "$file":/backup.dump:ro \
  -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  -e AWS_DEFAULT_REGION -e AWS_REQUEST_CHECKSUM_CALCULATION -e AWS_RESPONSE_CHECKSUM_VALIDATION \
  amazon/aws-cli \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  s3 cp /backup.dump "s3://${R2_BUCKET}/postgres/anki-${ts}.dump"

echo "$(date -u +%FT%TZ) backup ok: postgres/anki-${ts}.dump ($(du -h "$file" | cut -f1))"
