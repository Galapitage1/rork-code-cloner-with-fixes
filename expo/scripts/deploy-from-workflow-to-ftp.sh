#!/usr/bin/env bash

set -euo pipefail

# One-command flow:
# 1) push current branch
# 2) wait for GitHub Actions workflow run on pushed commit
# 3) download "deployment-package" artifact from that run
# 4) upload files to FTP target directory

WORKFLOW_NAME="${WORKFLOW_NAME:-Build and Deploy App}"
ARTIFACT_NAME="${ARTIFACT_NAME:-deployment-package}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-1200}"
FTP_SCHEME="${FTP_SCHEME:-ftp}"
FTP_PORT="${FTP_PORT:-21}"

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

extract_repo_slug() {
  local remote
  remote="$(git config --get remote.origin.url || true)"
  if [[ -z "$remote" ]]; then
    echo ""
    return
  fi

  local slug
  slug="$(printf '%s' "$remote" | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##')"
  if [[ "$slug" == */* ]]; then
    echo "$slug"
    return
  fi
  echo ""
}

require_command git
require_command gh
require_command jq
require_command curl
require_command find
require_command mktemp

REPO="${REPO:-$(extract_repo_slug)}"
if [ -z "$REPO" ]; then
  echo "ERROR: Could not determine GitHub repo slug. Set REPO=owner/repo." >&2
  exit 1
fi

require_env DEPLOY_FTP_HOST
require_env DEPLOY_FTP_USER
require_env DEPLOY_TARGET_PATH

FTP_PASSWORD="${DEPLOY_FTP_PASSWORD:-${GITHUBDEPLOY:-}}"
if [ -z "$FTP_PASSWORD" ]; then
  echo "ERROR: Set DEPLOY_FTP_PASSWORD (or fallback GITHUBDEPLOY)." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run: gh auth login -h github.com" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
echo "Pushing branch '$branch' to origin..."
git push origin "$branch"

head_sha="$(git rev-parse HEAD)"
echo "Pushed commit: $head_sha"

deadline=$((SECONDS + MAX_WAIT_SECONDS))
run_id=""
run_url=""

echo "Waiting for workflow '$WORKFLOW_NAME' to start for commit $head_sha..."
while [ $SECONDS -lt $deadline ]; do
  runs_json="$(gh api "repos/$REPO/actions/runs?head_sha=$head_sha&per_page=30")"
  run_id="$(printf '%s' "$runs_json" | jq -r --arg wf "$WORKFLOW_NAME" '.workflow_runs[] | select(.name == $wf) | .id' | head -n 1)"
  run_url="$(printf '%s' "$runs_json" | jq -r --arg wf "$WORKFLOW_NAME" '.workflow_runs[] | select(.name == $wf) | .html_url' | head -n 1)"
  if [ -n "${run_id:-}" ] && [ "$run_id" != "null" ]; then
    break
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

if [ -z "${run_id:-}" ] || [ "$run_id" = "null" ]; then
  echo "ERROR: Timed out waiting for workflow run to appear." >&2
  exit 1
fi

echo "Found workflow run: $run_id"
[ -n "${run_url:-}" ] && [ "$run_url" != "null" ] && echo "Run URL: $run_url"

status=""
conclusion=""
while [ $SECONDS -lt $deadline ]; do
  run_json="$(gh api "repos/$REPO/actions/runs/$run_id")"
  status="$(printf '%s' "$run_json" | jq -r '.status')"
  conclusion="$(printf '%s' "$run_json" | jq -r '.conclusion // ""')"
  run_url="$(printf '%s' "$run_json" | jq -r '.html_url')"

  echo "Workflow status: $status${conclusion:+ / $conclusion}"

  if [ "$status" = "completed" ]; then
    break
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

if [ "$status" != "completed" ]; then
  echo "ERROR: Timed out waiting for workflow completion." >&2
  [ -n "${run_url:-}" ] && [ "$run_url" != "null" ] && echo "Run URL: $run_url" >&2
  exit 1
fi

if [ "$conclusion" != "success" ]; then
  echo "ERROR: Workflow completed with conclusion '$conclusion'." >&2
  [ -n "${run_url:-}" ] && [ "$run_url" != "null" ] && echo "Run URL: $run_url" >&2
  exit 1
fi

temp_root="$(mktemp -d)"
artifact_root="$temp_root/artifact"
mkdir -p "$artifact_root"

echo "Downloading artifact '$ARTIFACT_NAME'..."
gh run download "$run_id" -R "$REPO" -n "$ARTIFACT_NAME" -D "$artifact_root"

source_dir="$artifact_root/$ARTIFACT_NAME"
if [ ! -d "$source_dir" ]; then
  source_dir="$artifact_root"
fi

if [ ! -f "$source_dir/index.html" ]; then
  candidate="$(find "$artifact_root" -mindepth 1 -maxdepth 2 -type d | head -n 1 || true)"
  if [ -n "$candidate" ]; then
    source_dir="$candidate"
  fi
fi

if [ ! -f "$source_dir/index.html" ]; then
  echo "ERROR: Could not locate unpacked deployment package (index.html missing)." >&2
  echo "Downloaded contents are in: $artifact_root" >&2
  exit 1
fi

remote_base="${DEPLOY_TARGET_PATH%/}"
if [[ "$remote_base" != /* ]]; then
  remote_base="/$remote_base"
fi

ftp_host_with_port="$DEPLOY_FTP_HOST"
if [ -n "$FTP_PORT" ]; then
  ftp_host_with_port="${DEPLOY_FTP_HOST}:$FTP_PORT"
fi

echo "Uploading files from $source_dir to ${FTP_SCHEME}://${DEPLOY_FTP_HOST}${remote_base}/ ..."

total_files="$(find "$source_dir" -type f | wc -l | tr -d ' ')"
uploaded=0
failed=0

while IFS= read -r -d '' file; do
  rel_path="${file#"$source_dir"/}"
  remote_path="${remote_base}/${rel_path}"
  remote_url="${FTP_SCHEME}://${ftp_host_with_port}${remote_path}"

  if ! curl --silent --show-error --fail \
    --retry 5 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 20 \
    --max-time 180 \
    --ftp-pasv \
    --ftp-create-dirs \
    --user "${DEPLOY_FTP_USER}:${FTP_PASSWORD}" \
    --upload-file "$file" \
    "$remote_url"; then
    failed=$((failed + 1))
    echo "Failed upload: $rel_path"
    continue
  fi

  uploaded=$((uploaded + 1))
  if (( uploaded % 100 == 0 )) || (( uploaded == total_files )); then
    echo "Uploaded $uploaded/$total_files files..."
  fi
done < <(find "$source_dir" -type f -print0)

if (( failed > 0 )); then
  echo "Upload finished with errors: uploaded=$uploaded failed=$failed total=$total_files"
  exit 1
fi

echo "Upload complete: $uploaded files uploaded."
echo "Workflow artifact source: $run_url"
echo "Local artifact folder: $artifact_root"
