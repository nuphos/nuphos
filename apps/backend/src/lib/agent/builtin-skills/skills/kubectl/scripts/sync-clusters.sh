#!/usr/bin/env bash
# Sync ~/.kube/config with every cluster this agent session can reach, across
# all supported providers. No arguments, idempotent, safe to re-run (e.g. after
# the user connects a new cluster). EKS/GKE contexts carry no credential at all
# — get-credential.sh fetches and renews one on demand via the exec stanza; the
# other providers relay a long-lived credential, which is embedded as-is.
# Runs automatically when the sandbox starts; run it manually only if
# ~/.kube/config is missing or a context you expect isn't listed.
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ -z "${NUPHOS_TOKEN:-}" ] || [ -z "${NUPHOS_SESSION_ID:-}" ]; then
  echo "NUPHOS_TOKEN / NUPHOS_SESSION_ID are not set — this script only works inside the Nuphos agent sandbox." >&2
  exit 1
fi

base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base="${base%/}"
url="${base}/agent-sessions/${NUPHOS_SESSION_ID}/kubeconfig"
connect_timeout=10
max_time=90

# --fresh re-issues provider credentials instead of reusing them. Only needed
# for a VKE cluster that keeps returning an in-cluster 403 after the user
# granted RBAC: VKE binds RBAC at credential-issue time, so the existing one
# stays forbidden forever.
if [ "${1:-}" = "--fresh" ]; then
  url="${url}?fresh=1"
elif [ "${1:-}" = "--onprem" ]; then
  # Fast bootstrap path: on-prem kubeconfigs are already encrypted in Mongo
  # and require no cloud inventory sweep. Claim-time sync uses this first so
  # an unrelated slow cloud account cannot delay the bound local cluster.
  url="${url}?scope=onprem"
  connect_timeout=3
  max_time=10
elif [ -n "${1:-}" ]; then
  echo "Usage: sync-clusters.sh [--fresh|--onprem]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skills_dir="$(cd "$script_dir/../.." && pwd)"

tmp="$(mktemp)"
resolved="$(mktemp)"
merged="$(mktemp)"
# Covers every scratch file for the whole run — `mv` already consumes the one
# it moves, and `rm -f` on a consumed path is a no-op.
trap 'rm -f "$tmp" "$resolved" "$merged"' EXIT

# Bounded so a blackholed backend fails this attempt instead of pinning the
# retry loop (and the sandbox exec that spawned it) indefinitely. Cluster
# enumeration sweeps cloud list APIs, so allow a generous ceiling.
http_code="$(curl -sS -o "$tmp" -w '%{http_code}' \
  --connect-timeout "$connect_timeout" --max-time "$max_time" \
  -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
  -H 'Accept: application/yaml' \
  "$url")"

mkdir -p "$HOME/.kube"
# Distinguishes "this session has no clusters" from "the sync never ran", so the
# backend's per-turn repair poke doesn't re-fire forever on a session that has
# nothing to sync (there is no kubeconfig to find in that case).
no_clusters_marker="$HOME/.kube/.nuphos-no-clusters"

if [ "$http_code" = "204" ]; then
  : > "$no_clusters_marker"
  echo "No Kubernetes clusters are reachable for this session — nothing to sync."
  echo "(Ask the user to connect a cloud account, or to enable one for this session.)"
  exit 0
fi

if [ "$http_code" != "200" ]; then
  echo "Nuphos backend returned HTTP ${http_code}:" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

sed "s|__NUPHOS_SKILLS_DIR__|${skills_dir}|g" "$tmp" > "$resolved"

rm -f "$no_clusters_marker"
out="$HOME/.kube/config"

# The fast on-prem bootstrap is only a partial response. Merge it ahead of the
# current config so a refreshed local context wins while existing cloud
# contexts remain usable until the detached full inventory sweep completes.
# A full response remains authoritative and replaces the file, which removes
# contexts (and embedded credentials) for accounts that were deselected.
if [ "${1:-}" = "--onprem" ] && [ -s "$out" ]; then
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "kubectl is required to merge the on-prem bootstrap with the existing config." >&2
    exit 1
  fi
  KUBECONFIG="$resolved:$out" kubectl config view --flatten > "$merged"
  mv "$merged" "$out"
else
  mv "$resolved" "$out"
fi
chmod 600 "$out"

echo "Synced cluster contexts into ${out}."
if command -v kubectl >/dev/null 2>&1; then
  kubectl config get-contexts
else
  echo "kubectl not installed yet — run: bash ${script_dir}/install.sh"
fi
