#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -lt 2 ]; then
  cat >&2 <<'USAGE'
Usage: connect.sh <teamId> <clientId>

Joins this sandbox to the team's tailnet as a short-lived node and writes an
ssh config so `ssh <tailnet-host>` works. Prints the reachable devices.
USAGE
  exit 2
fi

team_id="$1"
client_id="$2"

: "${NUPHOS_TOKEN:?NUPHOS_TOKEN is required}"
# The ordinary team route accepts only a conversation principal for this
# operation and enforces the selected binding plus its sandbox-access policy.

state_dir="${HOME}/.tailnet-ssh"
sock="${state_dir}/tailscaled.sock"
socks_port="${NUPHOS_TAILNET_SOCKS_PORT:-1055}"
log="${state_dir}/tailscaled.log"
# Delimiters so disconnect.sh removes exactly this block and nothing else.
SSH_CONFIG_MARKER="# >>> nuphos-tailnet-ssh >>>"
SSH_CONFIG_END="# <<< nuphos-tailnet-ssh <<<"

ts() { tailscale --socket="$sock" "$@"; }

mkdir -p "$state_dir"
chmod 700 "$state_dir"

if ts status >/dev/null 2>&1; then
  echo "Already joined this team's tailnet."
  ts status
  exit 0
fi

command -v tailscaled >/dev/null 2>&1 || bash "$(dirname "$0")/install.sh"

base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
url="${base%/}/teams/${team_id}/tailscale-clients/${client_id}/tailnet-sessions"

response="$(mktemp)"
keyfile="${state_dir}/authkey"
cleanup() { rm -f "$response" "$keyfile"; }
trap cleanup EXIT

status="$(curl -sS -X POST -w '%{http_code}' -o "$response" \
  -H "Authorization: Bearer ${NUPHOS_TOKEN}" \
  -H 'Content-Type: application/json' \
  "$url" || true)"

if [ "$status" != "200" ]; then
  echo "Could not mint a tailnet auth key (HTTP ${status})." >&2
  cat "$response" >&2 || true
  cat >&2 <<'HINT'

Common causes:
  403 tailscale_sandbox_access_disabled — an admin has not enabled private
      network access for this binding in Nuphos.
  403 tailscale_client_agent_access_denied — the binding is not selected in
      this session's credential selector.
  403 tailscale_auth_key_denied — the customer's OAuth client lacks the
      auth_keys scope, or does not own the configured tag.
HINT
  exit 1
fi

# The key never lands anywhere the agent's later commands would stumble over
# it: 0600, consumed by `tailscale up`, removed on exit.
umask 077
python3 - "$response" "$keyfile" "${state_dir}/session.env" <<'PY'
import json, shlex, sys

src, keyfile, envfile = sys.argv[1:4]
data = json.load(open(src, encoding="utf-8"))
for field in ("authKey", "tag", "hostname"):
    if not data.get(field):
        raise SystemExit(f"tailnet session response is missing {field}")

open(keyfile, "w", encoding="utf-8").write(data["authKey"])
open(envfile, "w", encoding="utf-8").write(
    "\n".join(
        [
            f"export NUPHOS_TAILNET_TAG={shlex.quote(data['tag'])}",
            f"export NUPHOS_TAILNET_HOSTNAME={shlex.quote(data['hostname'])}",
            "",
        ]
    )
)
PY
. "${state_dir}/session.env"

# --tun=userspace-networking keeps this inside a plain sandbox pod: no TUN
# device, no NET_ADMIN. state=mem: means the node identity dies with the pod.
#
# setsid detaches it from this exec session's process group. Without that the
# daemon is torn down when the exec that started it returns, and every
# subsequent command in the turn finds a dead socket.
setsid nohup tailscaled \
  --tun=userspace-networking \
  --socket="$sock" \
  --state=mem: \
  --socks5-server="127.0.0.1:${socks_port}" \
  --outbound-http-proxy-listen="127.0.0.1:${socks_port}" \
  >"$log" 2>&1 &

for _ in $(seq 1 50); do
  [ -S "$sock" ] && break
  sleep 0.2
done
if [ ! -S "$sock" ]; then
  echo "tailscaled did not start; last log lines:" >&2
  tail -n 20 "$log" >&2 || true
  exit 1
fi

# --shields-up is the promise made to the customer's security review: this node
# dials out and nothing in the tailnet can dial in to it.
if ! ts up \
  --auth-key="file:${keyfile}" \
  --hostname="$NUPHOS_TAILNET_HOSTNAME" \
  --accept-routes \
  --shields-up \
  --timeout=60s; then
  echo "tailscale up failed; last log lines:" >&2
  tail -n 20 "$log" >&2 || true
  exit 1
fi
rm -f "$keyfile"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh_config="$HOME/.ssh/config"
# Tailscale hands out 100.64.0.0/10. `Host 100.*` would also capture unrelated
# 100.0.0.0/8 addressing and silently route it through this node's bridge, so
# enumerate the second octet the /10 actually covers.
cgnat=$(seq 64 127 | sed 's#^#100.#; s#$#.*#' | tr '\n' ' ')
if ! grep -q "$SSH_CONFIG_MARKER" "$ssh_config" 2>/dev/null; then
  cat >>"$ssh_config" <<EOF

$SSH_CONFIG_MARKER
# Routes tailnet targets through this sandbox's tailnet node. Scoped to
# tailnet addresses so ordinary ssh is unaffected. Removed by disconnect.sh.
Host ${cgnat}*.ts.net
  ProxyCommand tailscale --socket=${sock} nc %h %p
  StrictHostKeyChecking accept-new
  UserKnownHostsFile ${state_dir}/known_hosts
$SSH_CONFIG_END
EOF
  chmod 600 "$ssh_config"
fi

echo "Joined as ${NUPHOS_TAILNET_HOSTNAME} (${NUPHOS_TAILNET_TAG})."
echo "SOCKS5 proxy for non-ssh tools: 127.0.0.1:${socks_port}"
echo

status_json="${state_dir}/status.json"
ts status --json >"$status_json"
python3 - "$status_json" <<'PY'
import json, sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
peers = list((data.get("Peer") or {}).values())
if not peers:
    print("No reachable peers. The tailnet ACL may not grant this tag access to anything.")
    raise SystemExit(0)

print("{:<34} {:<16} {:<10} {}".format("HOST", "ADDRESS", "OS", "ONLINE"))
for peer in sorted(peers, key=lambda p: p.get("DNSName") or ""):
    dns = (peer.get("DNSName") or "").rstrip(".")
    addr = (peer.get("TailscaleIPs") or [""])[0]
    print("{:<34} {:<16} {:<10} {}".format(dns, addr, peer.get("OS") or "", peer.get("Online")))
PY
