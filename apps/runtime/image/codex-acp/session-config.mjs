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
    'NUPHOS_SESSION_ACTOR',
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

// The session home each thread was last opened with by this adapter process.
const nuphosThreadHomes = new Map()

function nuphosThreadHome(meta, processEnv) {
  const env = meta?.['ai.nuphos/codex']?.env ?? {}
  const { NUPHOS_SESSION_ID, NUPHOS_SESSION_ACTOR } = env
  return nuphosSessionHomeEnv({ NUPHOS_SESSION_ID, NUPHOS_SESSION_ACTOR }, processEnv).HOME ?? ''
}

// App Server ignores a resume's config while a subscription holds the loaded
// thread. When the acting principal's home changed since this process last
// opened the thread, release the subscription first so the idle thread is
// rebuilt with the new config. Any other reload keeps the thread as it is.
export async function nuphosReleaseMovedThread(client, threadId, meta, processEnv = process.env) {
  const home = nuphosThreadHome(meta, processEnv)
  const last = nuphosThreadHomes.get(threadId)
  nuphosThreadHomes.set(threadId, home)
  if (last !== undefined && last !== home)
    await client.threadUnsubscribe({ threadId }).catch(() => {})
}

export function nuphosRememberThreadHome(threadId, meta, processEnv = process.env) {
  nuphosThreadHomes.set(threadId, nuphosThreadHome(meta, processEnv))
}
