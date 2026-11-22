import type {
  AgentCliStatus,
  AgentDevice,
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

export type LocalAgentStatus = 'checking' | 'ready' | 'signed-out' | 'missing' | 'unavailable'

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

/** A disabled or failed check must not look like an in-flight check. */
export function setupAgentStatus(
  state: LocalRuntimeState | null,
  provider: CliLoginProvider,
): LocalAgentStatus {
  const agent = state?.agents[provider]

  if (state?.detectionDisabled || (!agent?.cli && agent?.error)) return 'unavailable'

  return localAgentStatus(agent?.cli)
}

/**
 * OpenCode on the team's Box: it answers on OpenCode's free models with no sign-in, so a new
 * team's free Box gives it a runtime before anything is connected. Listed once the Box joined.
 */
export function boxOpenCode(
  instances: RuntimeInstance[],
  devices: AgentDevice[] = [],
): RuntimeInstance | undefined {
  const boxes = new Set(devices.filter((device) => device.box).map((device) => device.deviceId))

  return instances.find(
    (instance) =>
      instance.provider === 'opencode' &&
      instance.local !== undefined &&
      boxes.has(instance.local.deviceId),
  )
}
