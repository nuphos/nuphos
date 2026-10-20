import type {
  AgentCliStatus,
  CliLoginProvider,
  LocalRuntimeState,
} from '../../../api/device-types.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

export const LOCAL_SETUP_PROVIDERS = [
  'claude-code',
  'codex',
] as const satisfies readonly CliLoginProvider[]

export const LOCAL_AGENT_INFO: Record<
  CliLoginProvider,
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

export function readyLocalAgents(state: LocalRuntimeState | null): CliLoginProvider[] {
  return LOCAL_SETUP_PROVIDERS.filter(
    (provider) => localAgentStatus(state?.agents[provider].cli) === 'ready',
  )
}

/** A self-hosted agent that joined the team after `knownIds` was taken. */
export function newlyConnectedAgent(
  knownIds: ReadonlySet<string> | undefined,
  instances: readonly RuntimeInstance[],
): RuntimeInstance | undefined {
  if (!knownIds) return undefined

  return instances.find((instance) => instance.kind === 'external' && !knownIds.has(instance.id))
}

export type SetupScreen = 'local' | 'cloud' | 'box' | 'self-hosted' | 'done'

/** Which of the two stepper steps a screen belongs to; the completion screen has none. */
export function setupStep(screen: SetupScreen): 1 | 2 | undefined {
  if (screen === 'local') return 1
  if (screen === 'done') return undefined

  return 2
}
