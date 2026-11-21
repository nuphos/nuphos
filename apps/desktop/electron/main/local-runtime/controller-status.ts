// What the controller reports about its agents: to the backend over the tunnel, and to the app.
import { LOCAL_AGENT_PROVIDERS, probeFailure } from './agent-cli.ts'
import { userDir } from './controller-types.ts'
import { connectionOf } from './tunnel-streams.ts'

import type { LocalAgentProvider } from './agent-cli.ts'
import type {
  Agent,
  LocalAgentState,
  LocalRuntimeControllerDeps,
  LocalRuntimeState,
} from './controller-types.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

export function tunnelStatusOf(
  running: Record<LocalAgentProvider, Agent>,
  backendUrl: string,
): LocalRuntimeTunnelStatus {
  const agents: LocalRuntimeTunnelStatus['agents'] = {}

  for (const provider of LOCAL_AGENT_PROVIDERS) {
    const agent = running[provider]

    if (!agent.runtime || !agent.cli?.installed) {
      const failure = probeFailure(agent.cli)

      if (failure) agents[provider] = failure
      continue
    }
    agents[provider] = {
      cli: {
        installed: true,
        loggedIn: agent.cli.loggedIn,
        ...(agent.cli.apiKey ? { apiKey: true } : {}),
      },
      // An account's usage says nothing about a custom provider: unknown, not a stale figure.
      ...(agent.usage !== undefined && agent.usageAt && !agent.cli.customProvider
        ? { usage: agent.usage, usageAt: agent.usageAt }
        : {}),
      ...(agent.cli.accountKey ? { accountKey: agent.cli.accountKey } : {}),
      ...(agent.cli.version ? { version: `${provider} ${agent.cli.version}` } : {}),
      ...(agent.models ? { models: agent.models } : {}),
    }
  }

  const cliVersion = process.env.NUPHOS_CLI_VERSION

  return { agents, backendUrl, ...(cliVersion ? { cliVersion } : {}) }
}

export function agentStatesOf(
  agents: Record<LocalAgentProvider, Agent>,
  context: {
    available: (provider: LocalAgentProvider) => boolean
    online: boolean
    superseded: boolean
  },
): Record<LocalAgentProvider, LocalAgentState> {
  const entries = LOCAL_AGENT_PROVIDERS.map((provider): [LocalAgentProvider, LocalAgentState] => {
    const agent = agents[provider]
    const error = context.superseded
      ? 'Another Nuphos app on this computer took over the local runtime.'
      : agent.error

    return [
      provider,
      {
        available: context.available(provider),
        online: context.online && agent.runtime !== null,
        ...(error ? { error } : {}),
        cli: agent.cli,
      },
    ]
  })

  return Object.fromEntries(entries) as Record<LocalAgentProvider, LocalAgentState>
}

export function runtimeStateOf(
  deps: Pick<LocalRuntimeControllerDeps, 'bundle' | 'dataDir'>,
  agents: Record<LocalAgentProvider, Agent>,
  online: boolean,
  superseded: boolean,
  userId: string | null,
  instances?: LocalRuntimeState['instances'],
  revoked = false,
): LocalRuntimeState {
  const bundle = deps.bundle()

  return {
    ...(instances ? { instances } : {}),
    agents: agentStatesOf(agents, {
      online,
      superseded,
      available: (provider) => bundle?.adapters[provider] !== undefined,
    }),
    workspace: userId ? userDir(deps.dataDir(), userId, 'workspace') : null,
    userId,
    ...(userId ? { connection: connectionOf(online, superseded, revoked) } : {}),
  }
}
