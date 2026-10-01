#!/bin/bash
# Cases for guard-lint-config.sh. Run: bash .claude/hooks/guard-lint-config.test.sh
set -u

guard="$(cd "$(dirname "$0")" && pwd)/guard-lint-config.sh"
pass=0
fail=0

# No output plus exit 0 is how a PreToolUse hook says "not my business".
decide() {
  local out
  out=$(printf '%s' "$1" | NUPHOS_LINT_UNLOCK= bash "$guard")
  if [ -z "$out" ]; then
    echo allow
  else
    printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision'
  fi
}

check() {
  local want="$1" name="$2" payload="$3"
  local got
  got=$(decide "$payload")
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf '  ok   %-46s %s\n' "$name" "$got"
  else
    fail=$((fail + 1))
    printf '  FAIL %-46s want %s, got %s\n' "$name" "$want" "$got"
  fi
}

edit() { check "$1" "$2" "$(jq -nc --arg p "$3" '{tool_name:"Edit",tool_input:{file_path:$p}}')"; }
write() { check "$1" "$2" "$(jq -nc --arg p "$3" '{tool_name:"Write",tool_input:{file_path:$p}}')"; }
sh_cmd() { check "$1" "$2" "$(jq -nc --arg c "$3" '{tool_name:"Bash",tool_input:{command:$c}}')"; }

echo 'guarded paths are denied'
edit deny 'root eslint config' /repo/eslint.config.mjs
edit deny 'backend eslint config' /repo/apps/backend/eslint.config.js
write deny 'admin eslint config' /repo/apps/admin/eslint.config.mjs
edit deny 'desktop eslint config' /repo/apps/desktop/eslint.config.js
edit deny 'legacy .eslintrc' /repo/.eslintrc.json
edit deny 'eslint ignore file' /repo/.eslintignore
edit deny 'prettier rc' /repo/.prettierrc.json
edit deny 'prettier rc, no extension' /repo/.prettierrc
edit deny 'prettier config js' /repo/prettier.config.js
edit deny 'prettier ignore file' /repo/.prettierignore
edit deny 'a custom rule' /repo/eslint-rules/no-large-comment-block.js
edit deny 'a custom rule test' /repo/eslint-rules/no-duplicate-comment.test.mjs
edit deny 'the rule plugin index' /repo/eslint-rules/index.js
edit deny 'the format pre-commit gate' /repo/.githooks/pre-commit
edit deny 'the guard script itself' /repo/.claude/hooks/guard-lint-config.sh
edit deny 'config inside a worktree' /repo/.claude/worktrees/a/eslint.config.mjs

echo 'ordinary files are untouched'
edit allow 'backend source' /repo/apps/backend/src/config.ts
edit allow 'a backend test' /repo/apps/backend/src/config.env-sync.test.ts
edit allow 'desktop source' /repo/apps/desktop/src/main/index.ts
edit allow 'a dev script' /repo/scripts/release.ts
write allow 'package.json' /repo/apps/backend/package.json
edit allow 'the CI workflow' /repo/.github/workflows/ci.yml
edit allow 'project instructions' /repo/CLAUDE.md
edit allow 'settings.json' /repo/.claude/settings.json
edit allow 'a file merely named for eslint' /repo/apps/backend/src/eslint-report.ts
edit allow 'a doc about eslint config' /repo/docs/eslint.config.md

echo 'shell writes to guarded paths are denied'
sh_cmd deny 'in-place sed' 'sed -i "" s/15/50/ eslint.config.mjs'
sh_cmd deny 'redirect' 'echo x > apps/backend/eslint.config.js'
sh_cmd deny 'heredoc' 'cat <<EOF > eslint.config.mjs
EOF'
sh_cmd deny 'append redirect' 'echo "*" >> .prettierignore'
sh_cmd deny 'removing a rule' 'rm eslint-rules/no-duplicate-comment.js'
sh_cmd deny 'restoring a path from a branch' 'git checkout main -- eslint.config.mjs'
sh_cmd deny 'tee' 'echo {} | tee .prettierrc.json'
sh_cmd deny 'perl in place' 'perl -pi -e s/a/b/ .prettierignore'
sh_cmd deny 'moving a rule aside' 'mv eslint-rules/index.js /tmp/x.js'

echo 'shell reads and ordinary commands are untouched'
sh_cmd allow 'reading the config' 'cat eslint.config.mjs'
sh_cmd allow 'grepping the config' 'grep complexity eslint.config.mjs'
sh_cmd allow 'running the linter' 'bun run lint'
sh_cmd allow 'linting with an explicit config' 'npx eslint -c eslint.config.mjs .'
sh_cmd allow 'redirecting lint output elsewhere' 'npx eslint -c eslint.config.mjs . > /tmp/out.txt'
sh_cmd allow 'running the rule tests' 'bun run test eslint-rules'
sh_cmd allow 'writing an ordinary file' 'echo hi > /tmp/note.txt'
sh_cmd allow 'a normal commit' 'git commit -m "fix: thing"'

echo 'the guard stops at the project boundary'
scoped() {
  local want="$1" name="$2" path="$3" got
  got=$(jq -nc --arg p "$path" '{tool_name:"Edit",tool_input:{file_path:$p}}' |
    CLAUDE_PROJECT_DIR=/repo NUPHOS_LINT_UNLOCK= bash "$guard")
  [ -z "$got" ] && got=allow || got=$(printf '%s' "$got" | jq -r '.hookSpecificOutput.permissionDecision')
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf '  ok   %-46s %s\n' "$name" "$got"
  else
    fail=$((fail + 1))
    printf '  FAIL %-46s want %s, got %s\n' "$name" "$want" "$got"
  fi
}
scoped deny 'config inside the project' /repo/eslint.config.mjs
scoped allow 'a scratch probe config elsewhere' /tmp/probe/eslint.config.mjs
scoped allow 'another checkout entirely' /Users/me/other-repo/eslint.config.mjs

echo 'the unlock disables the guard'
got=$(jq -nc '{tool_name:"Edit",tool_input:{file_path:"/repo/eslint.config.mjs"}}' |
  NUPHOS_LINT_UNLOCK=1 bash "$guard")
[ -z "$got" ] && got=allow
if [ "$got" = "allow" ]; then
  pass=$((pass + 1))
  printf '  ok   %-46s %s\n' 'NUPHOS_LINT_UNLOCK=1' "$got"
else
  fail=$((fail + 1))
  printf '  FAIL %-46s want allow, got %s\n' 'NUPHOS_LINT_UNLOCK=1' "$got"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
