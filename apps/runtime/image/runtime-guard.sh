# Sourced by every non-interactive bash through BASH_ENV (set in the runtime
# ConfigMap). Not executable on its own.
#
# The container cgroup runs with memory.oom.group=1 and hosts up to
# `max_sessions` conversations, so a cgroup OOM kills every session and the ACP
# bridge together — the user just sees "OpenAB ACP connection closed" and the
# agent never learns what happened. Give each tool process its own ceiling so a
# single runaway build dies on its own rlimit instead: that failure is a normal
# non-zero exit with an "out of memory" message the agent can read and route
# around, and the pod keeps running.
#
# This bounds one process, not a process tree: N workers each just under the
# ceiling still add up to the container limit. Keeping trees narrow is the
# environment's job (GOFLAGS=-p=2, MAKEFLAGS=-j2, and the agent instructions),
# not this file's. A true per-tool aggregate bound would need a child cgroup,
# which a runtime cannot create for itself: /sys/fs/cgroup is mounted read-only,
# the container runs as an unprivileged uid, and cgroup.subtree_control is not
# writable. The pod cgroup stays the last-resort bound.
#
# RLIMIT_DATA (ulimit -d) rather than RLIMIT_AS (ulimit -v): Go reserves a large
# virtual address space at startup and panics in runtime.schedinit under a
# meaningful -v, before main() ever runs.

# The conversation token in the spawn-time env expires; OpenAB rewrites the
# current one into OPENAB_CREDENTIALS_DIR on every turn and deletes a revoked
# one, so a missing file must unset the stale value. Nested shells re-read it
# too, so this runs before the once-per-tree guard below.
if [ -n "${OPENAB_CREDENTIALS_DIR:-}" ]; then
  for nuphos_credential in NUPHOS_TOKEN NUPHOS_PLAN_API_TOKEN; do
    nuphos_credential_value=
    if [ -r "$OPENAB_CREDENTIALS_DIR/$nuphos_credential" ]; then
      IFS= read -r nuphos_credential_value <"$OPENAB_CREDENTIALS_DIR/$nuphos_credential" || true
    fi
    if [ -n "$nuphos_credential_value" ]; then
      export "$nuphos_credential=$nuphos_credential_value"
    else
      unset "$nuphos_credential"
    fi
  done
  unset nuphos_credential nuphos_credential_value
fi

if [ "${NUPHOS_RUNTIME_GUARD:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
export NUPHOS_RUNTIME_GUARD=1

# Soft limit only, so a tool that genuinely needs more can opt out for one
# command with `ulimit -S -d <kbytes>` and own the consequence.
export NUPHOS_MEM_SOFT_LIMIT_MB=2048
ulimit -S -d 2097152 2>/dev/null || true
