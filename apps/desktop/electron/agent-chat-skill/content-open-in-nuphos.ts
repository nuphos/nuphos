import type { AgentChatSkillTarget } from './types'

export function openInNuphosSkillBody(target: AgentChatSkillTarget): string {
  const source = target === 'codex' ? 'codex' : 'claude-code'
  const opener = target === 'codex' ? 'Codex' : 'Claude Code'

  return `---
name: open-in-nuphos
description: Open a Nuphos Agent chat with bug context, prompts, and local files when ${opener} needs Nuphos to investigate something.
---

# Open in Nuphos

Use this skill when you encounter a bug, failed command, confusing runtime behavior, or investigation that should be handed to Nuphos Agent.

## Workflow

1. Summarize the observed bug, expected behavior, actual behavior, commands run, relevant error output, repository path, and any hypothesis worth checking.
2. Put long logs or diagnostics into local files and pass those paths as \`file\` query parameters.
3. Open Nuphos with:

\`\`\`sh
scripts/open-in-nuphos --source ${source} --team-id team_xxx --prompt "Investigate this bug..." --file /path/to/error.log
\`\`\`

The helper opens \`nuphos://agent-chat\` and Nuphos will start an Agent chat with the prompt and attached local file paths.

Prefer passing files for logs or large command output instead of pasting everything into the prompt.
`
}

export const openInNuphosHelperScript = `#!/usr/bin/env bash
set -euo pipefail

source_name=""
prompt=""
cwd="$PWD"
team_id=""
files=()
draft=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      source_name="$2"
      shift 2
      ;;
    --prompt)
      prompt="$2"
      shift 2
      ;;
    --cwd)
      cwd="$2"
      shift 2
      ;;
    --team-id|--teamId)
      team_id="$2"
      shift 2
      ;;
    --file|--files)
      files+=("$2")
      shift 2
      ;;
    --draft)
      draft=1
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$prompt" && \${#files[@]} -eq 0 ]]; then
  echo "provide --prompt and/or --file" >&2
  exit 2
fi

python3 - "$source_name" "$prompt" "$cwd" "$team_id" "$draft" \${files[@]+"\${files[@]}"} <<'PY'
import sys
import urllib.parse
import subprocess
import platform
import os

source, prompt, cwd, team_id, draft, *files = sys.argv[1:]
params = []
if prompt:
    params.append(("prompt", prompt))
if source:
    params.append(("source", source))
if cwd:
    params.append(("cwd", cwd))
if team_id:
    params.append(("teamId", team_id))
if draft == "1":
    params.append(("draft", "1"))
for file_path in files:
    params.append(("file", file_path))

url = "nuphos://agent-chat?" + urllib.parse.urlencode(params)
system = platform.system()
if system == "Darwin":
    subprocess.run(["open", url], check=True)
elif system == "Windows":
    os.startfile(url)
else:
    subprocess.run(["xdg-open", url], check=True)
PY
`
