import { nuphosSessionHomeEnv } from '../session-home.mjs'

// Applied to thread/start and thread/resume on every ACP new/load/resume.
// Never change process.env: concurrent conversations have different principals.
export function nuphosCodexSessionConfig(config, meta, processEnv = process.env) {
  const context = meta?.['ai.nuphos/codex']
  if (!context) return config
  const allowed = new Set([
    'NUPHOS_TOKEN',
    'NUPHOS_BACKEND_URL',
    'NUPHOS_TEAM_ID',
    'TEAM',
    'NUPHOS_SESSION_ID',
    'NUPHOS_PLAN_API_BASE',
    'NUPHOS_PLAN_API_TOKEN',
  ])
  const env = Object.fromEntries(
    Object.entries(context.env ?? {}).filter(
      ([key, value]) => allowed.has(key) && typeof value === 'string',
    ),
  )
  // Preserve CLI discovery and the runtime home without inheriting transport
  // keys or unrelated credentials from an adapter process environment.
  const baseline = Object.fromEntries(
    // These budgets come from the managed runtime's [agent.env], never from
    // actor metadata. Codex otherwise drops them with inherit: 'none'.
    // BASH_ENV carries the whole hard ceiling: it is what sources
    // runtime-guard.sh, so dropping it leaves Codex shell commands with no
    // RLIMIT_DATA at all, and GOFLAGS/MAKEFLAGS are what keep a build's
    // process tree from adding up to the container limit behind that ceiling.
    [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'TERM',
      'TMPDIR',
      'GOMEMLIMIT',
      'NODE_OPTIONS',
      'GOFLAGS',
      'MAKEFLAGS',
      'BASH_ENV',
      'OPENAB_CREDENTIALS_DIR',
    ]
      .filter((key) => typeof processEnv[key] === 'string')
      .map((key) => [key, processEnv[key]]),
  )
  return {
    ...config,
    developer_instructions:
      typeof context.developerInstructions === 'string' ? context.developerInstructions : '',
    shell_environment_policy: {
      inherit: 'none',
      set: { ...baseline, ...env, ...nuphosSessionHomeEnv(env, processEnv) },
    },
    mcp_servers: Object.fromEntries(
      Object.entries(config.mcp_servers ?? {}).map(([name, server]) => [
        name,
        { ...server, tool_timeout_sec: 1800 },
      ]),
    ),
  }
}
