import type { LocalAgentProvider } from './agent-cli.ts'
import type { AgentInstanceRecord } from './agent-instances.ts'
import type { LocalRuntimeState } from './controller-types.ts'
import type { RunningRuntime } from './openab-process.ts'
import type { LocalRuntimeTunnelStatus } from './tunnel-protocol.ts'

export type Controller = {
  setUser(userId: string | null): Promise<void>
  shutdown(): Promise<void>
  refresh(restart: boolean): Promise<LocalRuntimeState>
  state(): LocalRuntimeState
  runtime(provider: LocalAgentProvider): RunningRuntime | null
  status(): LocalRuntimeTunnelStatus
}

export type Entry = {
  metadata: AgentInstanceRecord
  controller: Controller
  starting?: Promise<void>
  expiry?: ReturnType<typeof setTimeout>
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
  return [...entries].map(({ metadata, controller }) => {
    const cli = controller.state().agents[metadata.provider].cli

    return {
      ...publicMetadata(metadata),
      ...controller.status().agents[metadata.provider],
      cli: {
        installed: cli?.installed ?? false,
        loggedIn: cli?.installed ? cli.loggedIn : false,
        ...(cli?.installed && cli.apiKey ? { apiKey: true as const } : {}),
      },
    }
  })
}
