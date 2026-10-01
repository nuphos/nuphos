#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == '--stdin-credentials' ]]; then
  IFS= read -r SONAR_HOST_URL
  IFS= read -r SONAR_TOKEN
  IFS= read -r SONAR_PINNED_HOST
  IFS= read -r SONAR_PINNED_ADDRESS
  export SONAR_HOST_URL SONAR_TOKEN
fi

if [[ -z "${SONAR_HOST_URL:-}" ]]; then
  echo 'SONAR_HOST_URL is required' >&2
  exit 2
fi
if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo 'SONAR_TOKEN is required' >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required to run the isolated SonarQube scanner' >&2
  exit 2
fi

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$backend_dir/fixtures/sonarqube-demo"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/nuphos-sonarqube-fixture.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
cp -R "$fixture_dir/." "$work_dir/"
# Run the container with the invoking account's numeric uid/gid. The disposable
# fixture stays private to that account and only .scannerwork is writable.
host_uid="$(id -u)"
host_gid="$(id -g)"
chmod -R u+rwX,go-rwx "$work_dir"
install -d -m 700 "$work_dir/.scannerwork"

pin_args=()
if [[ -n "${SONAR_PINNED_HOST:-}" && -n "${SONAR_PINNED_ADDRESS:-}" && "$SONAR_PINNED_HOST" != "$SONAR_PINNED_ADDRESS" ]]; then
  pin_args=(--add-host "$SONAR_PINNED_HOST=$SONAR_PINNED_ADDRESS")
fi

docker run --rm \
  --read-only \
  --user "$host_uid:$host_gid" \
  --tmpfs "/tmp:rw,noexec,nosuid,size=256m,uid=$host_uid,gid=$host_gid,mode=0700" \
  --tmpfs "/opt/sonar-scanner/.sonar:rw,noexec,nosuid,size=256m,uid=$host_uid,gid=$host_gid,mode=0700" \
  -e SONAR_HOST_URL \
  -e SONAR_TOKEN \
  "${pin_args[@]}" \
  -v "$work_dir:/usr/src" \
  sonarsource/sonar-scanner-cli:11.4.0.2044_7.2.0
