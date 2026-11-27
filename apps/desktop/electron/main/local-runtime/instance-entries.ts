import type { LocalAgentProvider } from './agent-cli.ts'
import type { AgentInstanceRecord } from './agent-instances.ts'
import type { CliInstall } from './instance-deps.ts'
import type { LocalRuntimeState } from './controller-types.ts'
import type { RunningRuntime } from './openab-process.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'
import type { VaultToken } from './vault-token.ts'

export type Controller = {
  setUser(userId: string | null): Promise<void>
  shutdown(): Promise<void>
  refresh(
    restart: boolean,
    providers?: readonly LocalAgentProvider[],
    signedIn?: boolean,
  ): Promise<LocalRuntimeState>
  /** Runs `work` with the agent stopped; the next refresh starts it. */
  whileStopped<T>(provider: LocalAgentProvider, work: () => Promise<T>): Promise<T | undefined>
  state(): LocalRuntimeState
  runtime(provider: LocalAgentProvider): RunningRuntime | null
  /** `runtime`, for a stream that asks for the agent. */
  runtimeForStream(provider: LocalAgentProvider): RunningRuntime | null
  status(): LocalRuntimeTunnelStatus
}

export type Entry = {
  metadata: AgentInstanceRecord
  controller: Controller
  install?: CliInstall
  starting?: Promise<void>
  expiry?: ReturnType<typeof setTimeout>
  /** The shared token this agent signs in with; it is listed, not stored. */
  vault?: VaultToken
}

/** What the backend sees: legacy records count as signed-in agents until settled. */
export function publicMetadata({ instanceId, provider, label, state }: AgentInstanceRecord) {
  return { instanceId, provider, label, state: state ?? ('ready' as const) }
}

export function instanceStates(entries: Iterable<Entry>, online: boolean) {
  return [...entries].map(({ metadata, controller }) => ({
    ...publicMetadata(metadata),
    ...controller.state().agents[metadata.provider],
    workspace: controller.state().workspace,
    online: online && controller.runtime(metadata.provider) !== null,
  }))
}

export function instanceStatus(
  entries: Iterable<Entry>,
): NonNullable<LocalRuntimeTunnelStatus['instances']> {
  return [...entries].map(({ metadata, controller, install, vault }) => {
    const cli = controller.state().agents[metadata.provider].cli

    return {
      ...publicMetadata(metadata),
      ...(vault && { vault: true as const }),
      ...controller.status().agents[metadata.provider],
      cli: {
        installed: cli?.installed ?? false,
        loggedIn: cli?.installed ? cli.loggedIn : false,
        ...(cli?.installed && cli.apiKey ? { apiKey: true as const } : {}),
        ...(install?.installing ? { installing: true as const } : {}),
        ...(!cli?.installed && cli?.error ? { probeError: cli.error } : {}),
        ...(!cli?.installed && install?.error ? { installError: install.error } : {}),
      },
    }
  })
}
