#!/usr/bin/env bash
# grep exits 1 when a failure is not memory-related, which is the common path.
set -uo pipefail

# A Claude Code-native PostToolUseFailure hook. When a managed runtime
# container reaches its memory limit, the kernel kills one process instead of
# the whole container (kubelet singleProcessOOMKill) — normally the largest,
# often the runaway tool, which then exits 137; this turns that exit into
# something the agent can act on,
# so the conversation continues with a smaller approach instead of the user
# seeing a dropped connection.
#
# Deliberately bound to the failure event only. PostToolUse carries no exit
# status (its tool_response is just stdout/stderr/interrupted), so matching
# there would let any successful command that merely prints one of these
# strings — a log line, a grep hit, a review comment quoting them — fabricate a
# memory-failure story and push memory advice at the agent. The failure event
# carries `.error`, which is the exit code plus stderr of the command that
# actually failed.
#
# `.error` is still command-controlled: a repository script can print one of
# these tokens and exit non-zero. Nothing available to a hook can prove the
# memory limit was the cause, so the classification stays a signature match, stated
# as such.

payload=$(cat)

[ "$(printf '%s' "$payload" | jq -r '.hook_event_name // ""' 2>/dev/null)" = PostToolUseFailure ] || exit 0

# An interrupted call is the user stopping the turn, not a resource limit.
text=$(printf '%s' "$payload" | jq -r 'if .is_interrupt == true then "" else .error // "" end' 2>/dev/null)
[ -n "$text" ] || exit 0

pattern='signal: killed'
pattern+='|[Ee]xit (code|status) 137'
pattern+='|JavaScript heap out of memory'

printf '%s' "$text" | grep -Eq "$pattern" || exit 0

read -r -d '' context <<EOF || true
That command failed with a memory-exhaustion signature. The runtime
container's memory is shared with the other conversations in it, and when it
runs out the kernel kills one process, normally the largest — possibly this
command. Exit 137 means SIGKILL, which has other causes too, and the signature
comes from the command's own output, so treat this as a lead rather than a
verdict.

Do not retry the same command unchanged.

Use a smaller approach, and tell the user you are switching:
  - narrow the scope: build or vet one package, not ./...
  - lower parallelism: -p=1 for go, -j1 for make, --maxWorkers=1 for jest/tsc
  - stream large files (sed/awk/jq --stream) instead of reading them whole
  - batch the work rather than holding everything in memory at once
EOF

jq -n --arg ctx "$context" '{
  systemMessage: "A command failed with a memory-exhaustion signature; the agent was told to use a smaller approach.",
  suppressOutput: true,
  hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: $ctx }
}'
