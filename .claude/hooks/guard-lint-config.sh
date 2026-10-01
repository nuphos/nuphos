#!/bin/bash
# PreToolUse guard: refuses agent writes to the files that define lint policy.
# Reads the hook payload on stdin, prints a PreToolUse decision on stdout.
#
# Set NUPHOS_LINT_UNLOCK=1 in the environment to disable.

set -u

payload=$(cat)

if [ "${NUPHOS_LINT_UNLOCK:-}" = "1" ]; then
  exit 0
fi

# Files whose only job is to define or enforce lint policy. The extension list
# is closed so that prose about the config (docs/eslint.config.md) stays free.
CFG_EXT='(js|mjs|cjs|ts|mts|cts|json|json5|jsonc|ya?ml|toml)'
GUARDED_PATH="(^|/)(eslint\.config\.${CFG_EXT}|\.eslintrc(\.${CFG_EXT})?|\.eslintignore|\.prettierrc(\.${CFG_EXT})?|prettier\.config\.${CFG_EXT}|\.prettierignore)\$|/eslint-rules/|/\.githooks/|/\.claude/hooks/"

# Same set, as it would appear inside a shell command rather than as a path.
GUARDED_WORD='(eslint\.config\.|\.eslintrc|\.eslintignore|\.prettierrc|prettier\.config\.|\.prettierignore|eslint-rules/|\.githooks/|\.claude/hooks/)'

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

explain() {
  cat <<MSG
Blocked: $1 defines this repo's lint policy, and agents may not rewrite it.

A failing lint rule is a finding, not an obstacle. If you cannot satisfy a
rule, say which rule fired and on which file, and stop. Do not relax the
threshold, delete the rule, widen an ignore list, or disable the hook.

If loosening the rule really is the right call, it is a human decision and a
PR of its own. Two ways to proceed:
  - the human edits the file directly (this guard only covers agent tools), or
  - relaunch with NUPHOS_LINT_UNLOCK=1 to turn the guard off for a session.
MSG
}

tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty')

case "$tool" in
  Edit | Write | MultiEdit | NotebookEdit)
    path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    [ -n "$path" ] || exit 0
    # Scratch copies outside the repo are somebody's experiment, not our policy.
    project="${CLAUDE_PROJECT_DIR:-}"
    if [ -n "$project" ] && [ "${path#"$project"}" = "$path" ]; then
      exit 0
    fi
    if printf '%s' "$path" | grep -Eq "$GUARDED_PATH"; then
      deny "$(explain "$path")"
    fi
    ;;
  Bash)
    command=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
    [ -n "$command" ] || exit 0
    # Reads stay free; only a guarded path as the target of a mutation is
    # blocked. This net is deliberately shallow — see the PR for why.
    mutations="(>>?[[:space:]]*[^[:space:];|&]*${GUARDED_WORD})"
    mutations="${mutations}|((sed|perl|ruby|python3?)[[:space:]][^;|&]*(-[A-Za-z]*i([[:space:]]|=)|--in-place)[^;|&]*${GUARDED_WORD})"
    mutations="${mutations}|((tee|mv|cp|rm|truncate|dd|install|patch|ln)[[:space:]][^;|&]*${GUARDED_WORD})"
    mutations="${mutations}|(git[[:space:]]+(checkout|restore|switch|apply|stash)[^;|&]*${GUARDED_WORD})"
    if printf '%s' "$command" | grep -Eq "$mutations"; then
      deny "$(explain "the file this command writes to")"
    fi
    ;;
esac

exit 0
