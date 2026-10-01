#!/usr/bin/env bash
# grep exits 1 when a failure is not memory-related, which is the common path.
set -uo pipefail

# A Claude Code-native PostToolUseFailure hook. runtime-guard.sh caps each Bash
# process so a runaway tool dies on its own rlimit instead of taking the whole
# runtime pod down; this turns that exit into something the agent can act on,
# so the conversation continues with a smaller approach instead of the user
# seeing a dropped connection.
#
# Deliberately bound to the failure event only. PostToolUse carries no exit
# status (its tool_response is just stdout/stderr/interrupted), so matching
# there would let any successful command that merely prints one of these
# strings — a log line, a grep hit, a review comment quoting them — fabricate a
# memory-failure story and push ulimit advice at the agent. The failure event
# carries `.error`, which is the exit code plus stderr of the command that
# actually failed.
#
# `.error` is still command-controlled: a repository script can print one of
# these tokens and exit non-zero. Nothing available to a hook can prove the
# rlimit was the cause, so the classification stays a signature match, stated
# as such — and the text must never carry an instruction that weakens the
# sandbox. Raising the ceiling is documented in the runtime's own instructions,
# where the agent reads it as operator guidance rather than being handed it by
# the output of the command that just failed.

payload=$(cat)

[ "$(printf '%s' "$payload" | jq -r '.hook_event_name // ""' 2>/dev/null)" = PostToolUseFailure ] || exit 0

# An interrupted call is the user stopping the turn, not a resource limit.
text=$(printf '%s' "$payload" | jq -r 'if .is_interrupt == true then "" else .error // "" end' 2>/dev/null)
[ -n "$text" ] || exit 0

pattern='fatal error: out of memory'
pattern+='|runtime: out of memory'
pattern+='|out of memory allocating'
pattern+='|JavaScript heap out of memory'
pattern+='|virtual memory exhausted'
pattern+='|std::bad_alloc'
pattern+='|[Cc]annot allocate memory'
pattern+='|MemoryError'
pattern+='|ENOMEM'
pattern+='|signal: killed'
pattern+='|[Ee]xit (code|status) 137'

printf '%s' "$text" | grep -Eq "$pattern" || exit 0

limit_mb=${NUPHOS_MEM_SOFT_LIMIT_MB:-2048}

read -r -d '' context <<EOF || true
That command failed with output matching a memory-exhaustion signature. This
sandbox caps each process at ${limit_mb} MiB (RLIMIT_DATA), so running out of memory
is the likely cause — though the signature comes from the command's own output,
so treat it as a lead rather than a verdict. Either way the runtime pod is fine
and no other conversation was affected.

Do not retry the same command unchanged. The pod's memory limit is shared with
the other conversations running in it, and its cgroup kills every process at once
when that limit is reached, which drops the ACP connection for all of them.

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
