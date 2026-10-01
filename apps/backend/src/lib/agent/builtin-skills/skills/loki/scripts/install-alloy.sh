#!/usr/bin/env bash
# Install & configure Grafana Alloy on a GCE VM so its logs ship to Loki.
#
# Runs ON the target VM as root. The Nuphos agent pipes it over SSH:
#   gcloud compute ssh <vm> --zone <zone> --command \
#     "sudo LOKI_URL=http://10.0.0.5:3100 ENV_LABEL=stage SERVICE_LABEL=c-engine bash -s" \
#     < skills/loki/scripts/install-alloy.sh
#
# Idempotent: re-running upgrades nothing destructively — it rewrites
# /etc/alloy/config.alloy and restarts the service.
#
# Required env:
#   LOKI_URL         Loki base URL reachable FROM THIS VM, e.g. http://10.0.0.5:3100
# Optional env:
#   ENV_LABEL        `env` label value (default: stage)
#   SERVICE_LABEL    `service` label value (default: hostname)
#   EXTRA_LOG_PATHS  Comma-separated extra file globs, e.g. "/opt/app/logs/*.log,/srv/*.out"
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (use sudo)" >&2
  exit 1
fi
: "${LOKI_URL:?LOKI_URL is required, e.g. http://10.0.0.5:3100}"
LOKI_URL="${LOKI_URL%/}"
ENV_LABEL="${ENV_LABEL:-stage}"
SERVICE_LABEL="${SERVICE_LABEL:-$(hostname)}"
EXTRA_LOG_PATHS="${EXTRA_LOG_PATHS:-}"

# ── Install Alloy from the official Grafana repo (apt or dnf/yum) ────────────
if command -v alloy >/dev/null 2>&1; then
  echo "alloy already installed: $(alloy --version 2>/dev/null | head -1)"
elif command -v apt-get >/dev/null 2>&1; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/grafana.gpg
  echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
    > /etc/apt/sources.list.d/grafana.list
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq alloy
elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
  cat > /etc/yum.repos.d/grafana.repo <<'REPO'
[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
REPO
  if command -v dnf >/dev/null 2>&1; then dnf install -y alloy; else yum install -y alloy; fi
else
  echo "unsupported distro: need apt or dnf/yum" >&2
  exit 1
fi

# Journal + /var/log require group access the package doesn't always grant.
id -u alloy >/dev/null 2>&1 && usermod -aG adm,systemd-journal alloy 2>/dev/null || true

# ── Render config ────────────────────────────────────────────────────────────
# Label convention is FIXED across the fleet: {env, instance, service}. It is
# what makes time-range + keyword retrieval precise later — do not improvise.
EXTRA_TARGETS=""
if [ -n "$EXTRA_LOG_PATHS" ]; then
  IFS=',' read -r -a _paths <<< "$EXTRA_LOG_PATHS"
  for p in "${_paths[@]}"; do
    p="$(echo "$p" | sed 's/^ *//; s/ *$//')"
    [ -n "$p" ] || continue
    # Entries are interpolated into the Alloy config as quoted strings; a
    # quote/backslash/newline could break out of the string and inject config
    # (everything else stays literal — the heredoc doesn't re-expand values).
    case "$p" in
      *'"'* | *'\'* | *$'\n'*)
        echo "warning: skipping unsafe EXTRA_LOG_PATHS entry: $p" >&2
        continue
        ;;
    esac
    EXTRA_TARGETS="${EXTRA_TARGETS}    { __path__ = \"${p}\" },
"
  done
fi

mkdir -p /etc/alloy
cat > /etc/alloy/config.alloy <<EOF
// Managed by Nuphos (loki skill). Re-running the installer overwrites this file.
loki.write "default" {
  endpoint {
    url = "${LOKI_URL}/loki/api/v1/push"
  }
  external_labels = {
    env      = "${ENV_LABEL}",
    instance = "$(hostname)",
    service  = "${SERVICE_LABEL}",
  }
}

loki.source.journal "journal" {
  forward_to = [loki.write.default.receiver]
  labels     = { job = "systemd-journal" }
}

local.file_match "logfiles" {
  path_targets = [
    { __path__ = "/var/log/*.log" },
${EXTRA_TARGETS}  ]
}

loki.source.file "files" {
  targets    = local.file_match.logfiles.targets
  forward_to = [loki.write.default.receiver]
}
EOF

# ── Start + verify ───────────────────────────────────────────────────────────
systemctl enable alloy >/dev/null 2>&1 || true
systemctl restart alloy
# Give slow/loaded VMs up to 10s to reach active before declaring failure.
for _ in $(seq 1 10); do
  systemctl is-active --quiet alloy && break
  sleep 1
done
if ! systemctl is-active --quiet alloy; then
  echo "alloy failed to start; recent logs:" >&2
  journalctl -u alloy --no-pager -n 20 >&2 || true
  exit 1
fi

# Emit a marker line so the caller can verify end-to-end retrieval through
# Loki. `logger` can be missing on minimal images — a failed marker must not
# turn a successful install into a reported failure (set -e).
logger -t nuphos-onboarding "loki onboarding marker host=$(hostname) at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" ||
  echo "warning: logger unavailable, onboarding marker not emitted — verify with a live log line instead" >&2

echo "OK alloy=active loki=${LOKI_URL} labels=env:${ENV_LABEL},instance:$(hostname),service:${SERVICE_LABEL}"
