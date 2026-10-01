#!/usr/bin/env bash
# kubectl ExecCredential plugin (client.authentication.k8s.io/v1). kubectl,
# helm, and every other client-go tool invoke this automatically through the
# exec stanza in ~/.kube/config — it is never meant to be run by hand. It
# fetches a short-lived cluster token from the Nuphos backend, caches it next
# to the kubeconfig, and re-fetches transparently once the token nears expiry.
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -lt 4 ]; then
  echo "usage: get-credential.sh <aws|gcp> <teamId> <account> <clusterName> [regionOrLocation]" >&2
  exit 1
fi

provider="$1"
team_id="$2"
account="$3"
cluster="$4"
region="${5:-}"

if [ -z "${NUPHOS_TOKEN:-}" ]; then
  echo "NUPHOS_TOKEN is not set — this plugin only works inside the Nuphos agent sandbox." >&2
  exit 1
fi

case "$provider" in
  aws)
    path="/teams/${team_id}/aws-accounts/${account}/clusters/${cluster}/exec-credential"
    if [ -n "$region" ]; then path="${path}?region=${region}"; fi
    ;;
  gcp)
    path="/teams/${team_id}/gcp-projects/${account}/clusters/${cluster}/exec-credential"
    if [ -n "$region" ]; then path="${path}?location=${region}"; fi
    ;;
  *)
    echo "unknown provider: $provider (expected aws | gcp)" >&2
    exit 1
    ;;
esac

base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base="${base%/}"
url="${base}${path}"

cache_dir="$HOME/.kube/nuphos-cred-cache"
mkdir -p "$cache_dir"
chmod 700 "$cache_dir"
# Region belongs in the key: two clusters in one account can share a name
# across regions, and the kubeconfig gives them distinct contexts. Without the
# region they would share one cache file, so the second cluster would be handed
# the first one's token for the rest of the TTL.
key="${provider}-${account}-${cluster}${region:+-${region}}"
cred_file="${cache_dir}/${key}.json"
exp_file="${cache_dir}/${key}.expires"

now="$(date +%s)"
if [ -f "$cred_file" ] && [ -f "$exp_file" ]; then
  exp="$(cat "$exp_file" 2>/dev/null || echo 0)"
  case "$exp" in
    *[!0-9]*) exp=0 ;;
  esac
  # 60s margin so a token never expires mid-request.
  if [ "$now" -lt "$((exp - 60))" ]; then
    cat "$cred_file"
    exit 0
  fi
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# kubectl gives an exec plugin no deadline of its own — an unbounded curl here
# hangs every kubectl call forever instead of failing with a readable error.
http_code="$(curl -sS -o "$tmp" -w '%{http_code}' \
  --connect-timeout 10 --max-time 30 \
  -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
  "$url")"

if [ "$http_code" != "200" ]; then
  case "$http_code" in
    403)
      echo "Nuphos refused cluster credentials for ${provider}/${account}/${cluster} (HTTP 403)." >&2
      echo "The member account lacks Access on the backing credential, or it was not selected for this agent session." >&2
      echo "Do NOT retry and do NOT request access from inside the sandbox — ask the user or a team admin to update the integration's Access allow list or session credential selection." >&2
      ;;
    401)
      echo "The Nuphos session token was rejected (HTTP 401) — the agent session itself is no longer valid." >&2
      ;;
    *)
      echo "Nuphos backend returned HTTP ${http_code} while fetching cluster credentials:" >&2
      ;;
  esac
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

# Cache until the backend-reported expiry; fall back to 5 minutes if the
# timestamp is missing or unparsable (GNU date required, present in the
# sandbox image via coreutils).
ts="$(grep -o '"expirationTimestamp" *: *"[^"]*"' "$tmp" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
exp=""
if [ -n "$ts" ]; then
  exp="$(date -d "$ts" +%s 2>/dev/null || true)"
fi
if [ -z "$exp" ]; then
  exp="$((now + 300))"
fi

mv "$tmp" "$cred_file"
trap - EXIT
chmod 600 "$cred_file"
printf '%s\n' "$exp" > "$exp_file"
cat "$cred_file"
