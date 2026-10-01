// Sandbox rules that apply to a managed runtime pod regardless of provider,
// plus the few lines that are true only for one of them.

export const TOOL_MEMORY_BUDGET_NOTE = [
  '## Tool memory budgets',
  '',
  'Managed runtimes have an 8 GiB container limit shared by the agent and every conversation in this pod, and the cgroup kills all of them at once when that limit is reached — one runaway tool would drop the connection for everyone. So each tool process carries its own ceiling instead: a 2 GiB RLIMIT_DATA soft limit, with the language runtimes budgeted below it (1536 MiB for both GOMEMLIMIT and the V8 old-space) and `GOFLAGS=-p=2` / `MAKEFLAGS=-j2`.',
  'That ceiling binds one process, not a process tree — eight workers each just under it still add up to the container limit. So keep concurrency low in anything that fans out by core count (`--maxWorkers`, `-j`, `-p`, worker pools, `xargs -P`), not only in the two build tools that already default to two.',
  'Keep these defaults. Run dependency installs, code generation, type checks, and builds sequentially within a conversation. Before retrying a failed or long-running command, wait for or stop the previous process; do not start a duplicate build.',
  "A tool that dies with an out-of-memory error hit its own ceiling, not the container's: the pod and the other conversations are unaffected. Do not retry the same command. Narrow the scope (one package, not `./...`), lower parallelism (`-p=1`, `-j1`, `--maxWorkers=1`), or stream large inputs instead of reading them whole — and tell the user you switched approaches. If the job genuinely needs more, raise the ceiling for that one command with `ulimit -S -d <kbytes>` rather than removing it.",
].join('\n')

export const CREDENTIAL_HANDLING_NOTE = [
  '## Credential handling',
  '',
  'Cloud credential values are short-lived: fetch one right before use, and never persist it into the workspace.',
  'Credential values must NEVER appear in a command line, script argument, or anything else that lands in the visible transcript — the user sees every command you run. Write them to the standard config location instead (`~/.aws/credentials`, `~/.config/gcloud`, a `~/.netrc` entry, or an env file under `~` sourced by the command), then run the command without inlining any secret.',
  "On runtimes with session isolation, `HOME` / `NUPHOS_SESSION_HOME` and the CLI config environment variables point to this conversation's own persistent directory. Keep these defaults and respect `CLOUDSDK_CONFIG`, `GH_CONFIG_DIR`, `AWS_SHARED_CREDENTIALS_FILE`, `AWS_CONFIG_FILE`, `KUBECONFIG`, and `GIT_CONFIG_GLOBAL`. Do not copy credentials or config from the runtime owner or another session. Without `NUPHOS_SESSION_HOME`, CLI defaults may use shared runtime configuration; be aware of the affected scope.",
  'Changing runtime-global settings is possible, but strongly discouraged unless the user understands the effect on other sessions and explicitly requests that scope. This includes bypassing the session paths, editing shared shell startup files, using a system credential store, or changing shared tools. Explain the affected scope before doing so. Session directories prevent accidental cross-session changes; they are not an OS security boundary. A separate `local_exec` host tool and remote SSH commands act on their target machine, not inside this session home.',
].join('\n')

export const MEMORY_SCOPE_NOTE = [
  '## Memory scope',
  '',
  'When calling `save_memory`, always pass `scope` explicitly. In a team conversation, shared infrastructure state or changes, operational decisions, and reusable investigation findings belong to `scope: "team"`. Use `scope: "personal"` only for preferences or context specific to the current user. Never let omission silently turn shared team knowledge into personal memory.',
  'For team facts, changes, or decisions, provide a self-contained `text`, `title`, and retrieval `keywords`; for a reusable team procedure, provide the required `gene` Playbook. Save only concrete, verified evidence from completed work.',
].join('\n')

export const CODEX_WORKSPACE_NOTE = [
  '## Workspace',
  '',
  "This is the Codex runtime, and `/workspace` is your working directory inside this team's sandbox. It is per-pod scratch space: keep credentials, CLI config, and anything that must survive a restart under `~` instead. The skill trees mounted under `/workspace` are read-only.",
].join('\n')
