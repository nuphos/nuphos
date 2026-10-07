import type { LocalTerminalEvent, TerminalTarget } from './local-terminal-types'
import type { Plan } from './plan-types.ts'
import type { K8sWatchEvent, K8sWatchKind, K8sWatchSubscribeResult } from './watch-types.ts'
import type { PodExecEvent, SshTerminalEvent } from '../types/aws-compute.ts'
import type { PodPort } from '../types/k8s-core.ts'
import type { PortForwardEvent, PortForwardInfo } from '../types/navigation.ts'

/** Mirrors the AppShortcut union in electron/main/windows.ts. */
export type AppShortcutAction =
  | 'new-chat'
  | 'new-tab'
  | 'close-tab'
  | 'previous-tab'
  | 'next-tab'
  | 'open-settings'
  | 'open-team-settings'
  | 'toggle-sidebar'
  | 'shortcuts-help'
  | 'reopen-closed-tab'
  | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export type WindowShellApi = {
  localTerminalStart(
    id: string,
    cols: number,
    rows: number,
    target?: TerminalTarget,
  ): Promise<{ id: string; shell: string }>
  localTerminalReplay(id: string): Promise<void>
  localTerminalInput(id: string, data: string): Promise<void>
  localTerminalResize(id: string, cols: number, rows: number): Promise<void>
  localTerminalClose(id: string): Promise<void>
  onLocalTerminalEvent(callback: (event: LocalTerminalEvent) => void): () => void
  appOpenExternal(url: string): Promise<void>
  appOpenSsh(url: string): Promise<void>
  sshTerminalInput(id: string, data: string): Promise<void>
  sshTerminalReplay(id: string): Promise<void>
  sshTerminalClose(id: string): Promise<void>
  onSshTerminalEvent(cb: (payload: SshTerminalEvent) => void): () => void
  podExecStart(
    id: string,
    context: string,
    namespace: string,
    pod: string,
    container: string,
    opts?: { cols?: number; rows?: number; shell?: string },
  ): Promise<{ id: string }>
  nodeExecStart(
    id: string,
    context: string,
    node: string,
    opts?: { cols?: number; rows?: number },
  ): Promise<{ id: string }>
  podExecHasSession(id: string): Promise<boolean>
  podExecDetach(id: string): Promise<void>
  podExecCloseTabScope(tabId: string, scope: string | null): Promise<void>
  podExecInput(id: string, data: string): Promise<void>
  podExecResize(id: string, cols: number, rows: number): Promise<void>
  podExecReplay(id: string): Promise<void>
  podExecClose(id: string): Promise<void>
  onPodExecEvent(cb: (payload: PodExecEvent) => void): () => void
  onAgentEvent(cb: (payload: { streamId: string; event: unknown }) => void): () => void
  onAgentPlanUpdated(cb: (payload: { plan: Plan }) => void): () => void
  onAppShortcut(cb: (action: AppShortcutAction) => void): () => void
  k8sStartPortForward(
    context: string,
    ns: string,
    pod: string,
    targetPort: number,
    localPort?: number,
  ): Promise<PortForwardInfo>
  k8sStartServicePortForward(
    context: string,
    ns: string,
    service: string,
    servicePort: number,
    localPort?: number,
  ): Promise<PortForwardInfo>
  k8sGetPodPortForwardOptions(context: string, ns: string, pod: string): Promise<PodPort[]>
  k8sGetServicePortForwardOptions(context: string, ns: string, service: string): Promise<PodPort[]>
  k8sStopPortForward(id: string): Promise<void>
  k8sListPortForwards(): Promise<PortForwardInfo[]>
  onPortForwardEvent(cb: (payload: PortForwardEvent) => void): () => void
  k8sWatchSubscribe(
    context: string,
    kind: K8sWatchKind,
    namespace: string | null,
  ): Promise<K8sWatchSubscribeResult>
  k8sWatchUnsubscribe(subscriptionId: string): Promise<void>
  k8sWatchRefresh(context: string, kind: K8sWatchKind, namespace: string | null): Promise<void>
  onK8sWatchEvent(cb: (payload: K8sWatchEvent) => void): () => void
}
