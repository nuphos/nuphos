import type {
  AgentCliStatus,
  LocalAgentProvider,
  LocalRuntimeState,
} from '../../../api/device-types.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'
import type { AtlasTeam } from '../../../types/team.ts'

export const LOCAL_SETUP_PROVIDERS = [
  'claude-code',
  'codex',
] as const satisfies readonly LocalAgentProvider[]

export const LOCAL_AGENT_INFO: Record<
  LocalAgentProvider,
  { name: string; maker: string; installUrl: string }
> = {
  'claude-code': {
    name: 'Claude Code',
    maker: 'Anthropic',
    installUrl: 'https://code.claude.com/docs/en/setup',
  },
  codex: { name: 'Codex', maker: 'OpenAI', installUrl: 'https://developers.openai.com/codex/cli' },
}

export type LocalAgentStatus = 'checking' | 'ready' | 'signed-out' | 'missing'

/** Where one local agent stands, from its own CLI as this computer last saw it. */
export function localAgentStatus(cli: AgentCliStatus | null | undefined): LocalAgentStatus {
  if (!cli) return 'checking'
  if (!cli.installed) return 'missing'

  return cli.loggedIn === true ? 'ready' : 'signed-out'
}

export function readyLocalAgents(state: LocalRuntimeState | null): LocalAgentProvider[] {
  return LOCAL_SETUP_PROVIDERS.filter(
    (provider) => localAgentStatus(state?.agents[provider].cli) === 'ready',
  )
}

/** Only administrators add cloud agents; `undefined` while the team list is still loading. */
export function canAddCloudAgent(
  teams: readonly AtlasTeam[] | undefined,
  teamId: string,
): boolean | undefined {
  if (!teams) return undefined

  return teams.find((team) => team.id === teamId)?.role === 'ADMINISTRATOR'
}

/** A self-hosted agent that joined the team after `knownIds` was taken. */
export function newlyConnectedAgent(
  knownIds: ReadonlySet<string> | undefined,
  instances: readonly RuntimeInstance[],
): RuntimeInstance | undefined {
  if (!knownIds) return undefined

  return instances.find((instance) => instance.kind === 'external' && !knownIds.has(instance.id))
}

export type SetupScreen = 'local' | 'cloud' | 'managed' | 'self-hosted' | 'done'

/** Which of the two stepper steps a screen belongs to; the completion screen has none. */
export function setupStep(screen: SetupScreen): 1 | 2 | undefined {
  if (screen === 'local') return 1
  if (screen === 'done') return undefined

  return 2
}
