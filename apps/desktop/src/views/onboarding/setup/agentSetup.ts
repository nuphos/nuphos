import type {
  AgentCliStatus,
  CliLoginProvider,
  LocalRuntimeState,
} from '../../../api/device-types.ts'
import type { LocalAgentProvider } from '../../../api/local-agent-providers.ts'

export const LOCAL_SETUP_PROVIDERS = [
  'claude-code',
  'codex',
] as const satisfies readonly CliLoginProvider[]

export const LOCAL_AGENT_INFO: Record<
  CliLoginProvider,
  /** `command` is what Nuphos looks for on the login shell's PATH. */
  { name: string; installUrl: string; command: string }
> = {
  'claude-code': {
    name: 'Claude Code',
    installUrl: 'https://code.claude.com/docs/en/setup',
    command: 'claude',
  },
  codex: {
    name: 'Codex',
    installUrl: 'https://developers.openai.com/codex/cli',
    command: 'codex',
  },
}

/** `found`: installed, by a read-only look where local runtimes are off, so sign-in is unknown. */
export type LocalAgentStatus =
  'checking' | 'ready' | 'signed-out' | 'missing' | 'found' | 'unavailable'

/** Where one local agent stands, from its own CLI as this computer last saw it. */
export function localAgentStatus(cli: AgentCliStatus | null | undefined): LocalAgentStatus {
  if (!cli) return 'checking'
  if (!cli.installed) return 'missing'

  return cli.loggedIn === true ? 'ready' : 'signed-out'
}

export function readyLocalAgents(state: LocalRuntimeState | null): CliLoginProvider[] {
  return LOCAL_SETUP_PROVIDERS.filter(
    (provider) => localAgentStatus(state?.agents[provider].cli) === 'ready',
  )
}

/**
 * A disabled or failed check must not look like an in-flight check. Where local
 * runtimes are off, `scanned` (a read-only look for their tools) still tells
 * installed from missing.
 */
export function setupAgentStatus(
  state: LocalRuntimeState | null,
  provider: LocalAgentProvider,
  scanned?: readonly string[] | null,
): LocalAgentStatus {
  const agent = state?.agents[provider]

  if (state?.detectionDisabled && scanned) return scanned.includes(provider) ? 'found' : 'missing'
  if (state?.detectionDisabled || (!agent?.cli && agent?.error)) return 'unavailable'

  return localAgentStatus(agent?.cli)
}
