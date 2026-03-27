#!/usr/bin/env bash

set -euo pipefail

# Incremental FTP deploy:
# - Upload only changed files from dist/ and Tracker/
# - Keep Tracker/ precedence when remote paths overlap
# - Upload index.html last (optionally always) to reduce partial-update windows

WORKDIR="${WORKDIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FTP_SCHEME="${FTP_SCHEME:-ftp}"
FTP_PORT="${FTP_PORT:-21}"
FORCE_INDEX_UPLOAD="${FORCE_INDEX_UPLOAD:-1}"
MANIFEST_DIR="${MANIFEST_DIR:-$WORKDIR/.deploy-cache}"
MANIFEST_FILE="${MANIFEST_FILE:-$MANIFEST_DIR/ftp_manifest_v1.tsv}"

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Missing required command: $cmd" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "ERROR: Required environment variable is not set: $name" >&2
    exit 1
  fi
}

require_command curl
require_command find
require_command awk
require_command sort
require_command shasum
require_command mktemp

require_env DEPLOY_FTP_HOST
require_env DEPLOY_FTP_USER
require_env DEPLOY_TARGET_PATH

FTP_PASSWORD="${DEPLOY_FTP_PASSWORD:-${GITHUBDEPLOY:-}}"
if [ -z "$FTP_PASSWORD" ]; then
  echo "ERROR: Set DEPLOY_FTP_PASSWORD (or fallback GITHUBDEPLOY)." >&2
  exit 1
fi

remote_base="${DEPLOY_TARGET_PATH%/}"
if [[ "$remote_base" != /* ]]; then
  remote_base="/$remote_base"
fi

ftp_host_with_port="${DEPLOY_FTP_HOST}:${FTP_PORT}"

mkdir -p "$MANIFEST_DIR"
if [ ! -f "$MANIFEST_FILE" ]; then
  : > "$MANIFEST_FILE"
fi

tmp_all="$(mktemp)"
tmp_new="$(mktemp)"
tmp_changed_raw="$(mktemp)"
tmp_changed="$(mktemp)"
tmp_success="$(mktemp)"
tmp_failed="$(mktemp)"

cleanup() {
  rm -f "$tmp_all" "$tmp_new" "$tmp_changed_raw" "$tmp_changed" "$tmp_success" "$tmp_failed"
}
trap cleanup EXIT

hash_file() {
  local file="$1"
  shasum -a 256 "$file" | awk '{print $1}'
}

append_entries() {
  local base_dir="$1"
  local skip_root_index="${2:-0}"
  if [ ! -d "$base_dir" ]; then
    return
  fi
  while IFS= read -r -d '' src; do
    local rel="${src#"$base_dir"/}"
    if [ "$skip_root_index" = "1" ] && [ "$rel" = "index.html" ]; then
      continue
    fi
    local h
    h="$(hash_file "$src")"
    printf '%s\t%s\t%s\n' "$h" "$rel" "$src" >> "$tmp_all"
  done < <(find "$base_dir" -type f -print0)
}

# Build candidate list. Tracker entries are appended after dist so they win on overlap.
append_entries "$WORKDIR/dist" "0"
# Skip Tracker/index.html so web root always comes from dist/index.html.
append_entries "$WORKDIR/Tracker" "1"

if [ ! -s "$tmp_all" ]; then
  echo "ERROR: No files found under dist/ or Tracker/." >&2
  exit 1
fi

# Keep only last row per remote path, then sort by remote path for stable processing.
awk -F'\t' '{row[$2]=$0} END {for (k in row) print row[k]}' "$tmp_all" | sort -t $'\t' -k2,2 > "$tmp_new"

# Select changed files compared to previous manifest.
awk -F'\t' '
  FILENAME == ARGV[1] { old[$2]=$1; next }
  { if (!($2 in old) || old[$2] != $1) print $0 }
' "$MANIFEST_FILE" "$tmp_new" > "$tmp_changed_raw"

if [ "$FORCE_INDEX_UPLOAD" = "1" ]; then
  awk -F'\t' '$2 == "index.html" { print $0 }' "$tmp_new" >> "$tmp_changed_raw"
fi

# Dedupe changed list by remote path (keep last) and sort.
awk -F'\t' '{row[$2]=$0} END {for (k in row) print row[k]}' "$tmp_changed_raw" | sort -t $'\t' -k2,2 > "$tmp_changed"

changed_count="$(wc -l < "$tmp_changed" | tr -d ' ')"
total_count="$(wc -l < "$tmp_new" | tr -d ' ')"

echo "Incremental deploy: $changed_count changed file(s) out of $total_count tracked file(s)."

if [ "$changed_count" -eq 0 ]; then
  echo "No changes to upload."
  exit 0
fi

upload_file() {
  local src="$1"
  local rel="$2"
  local remote_url="${FTP_SCHEME}://${ftp_host_with_port}${remote_base}/${rel}"

  if ! curl --silent --show-error --fail \
    --retry 8 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 25 \
    --max-time 300 \
    --ftp-pasv \
    --ftp-create-dirs \
    --user "${DEPLOY_FTP_USER}:${FTP_PASSWORD}" \
    --upload-file "$src" \
    "$remote_url"; then
    echo "$rel" >> "$tmp_failed"
    return 1
  fi
  echo "$rel" >> "$tmp_success"
  return 0
}

echo "Uploading changed files (index.html deferred)..."
while IFS=$'\t' read -r _hash rel src; do
  if [ "$rel" = "index.html" ]; then
    continue
  fi
  if [ ! -f "$src" ]; then
    if [[ "$rel" == */index.html ]] && [ -f "$WORKDIR/dist/index.html" ]; then
      src="$WORKDIR/dist/index.html"
    else
      echo "$rel" >> "$tmp_failed"
      continue
    fi
  fi
  echo "Uploading $rel"
  upload_file "$src" "$rel" || true
done < "$tmp_changed"

if awk -F'\t' '$2 == "index.html" { found=1 } END { exit(found ? 0 : 1) }' "$tmp_changed"; then
  index_src="$(awk -F'\t' '$2 == "index.html" { src=$3 } END { print src }' "$tmp_changed")"
  if [ -n "$index_src" ] && [ -f "$index_src" ]; then
    echo "Uploading index.html last..."
    upload_file "$index_src" "index.html" || true
  fi
fi

uploaded="$(wc -l < "$tmp_success" | tr -d ' ')"
failed="$(wc -l < "$tmp_failed" | tr -d ' ')"

echo "Uploaded $uploaded changed file(s)."

if [ "$failed" -gt 0 ]; then
  echo "Upload finished with failures ($failed file(s)). First failures:"
  head -n 20 "$tmp_failed" || true
  exit 1
fi

cp "$tmp_new" "$MANIFEST_FILE"
echo "Incremental FTP deploy complete."
