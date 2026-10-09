import type { Plan } from './plan-types.ts'
import type { K8sWatchEvent, K8sWatchKind } from './watch-types.ts'
import type { PodExecEvent, SshTerminalEvent } from '../types/aws-compute.ts'
import type { PortForwardEvent } from '../types/navigation.ts'

export const shellApi = {
  acceptDockTerminal: (id: string) => window.api.acceptDockTerminal(id),
  onDockTerminalRequest: (...args: Parameters<typeof window.api.onDockTerminalRequest>) => window.api.onDockTerminalRequest(...args),
  localTerminalStart: (...args: Parameters<typeof window.api.localTerminalStart>) =>
    window.api.localTerminalStart(...args),
  localTerminalReplay: (id: string) => window.api.localTerminalReplay(id),
  localTerminalInput: (id: string, data: string, fromUser = true) => window.api.localTerminalInput(id, data, fromUser),
  localTerminalResize: (id: string, cols: number, rows: number) =>
    window.api.localTerminalResize(id, cols, rows),
  localTerminalClose: (id: string) => window.api.localTerminalClose(id),
  onLocalTerminalEvent: (...args: Parameters<typeof window.api.onLocalTerminalEvent>) =>
    window.api.onLocalTerminalEvent(...args),
  appOpenExternal: (url: string) => window.api.appOpenExternal(url),
  appOpenSsh: (url: string) => window.api.appOpenSsh(url),
  sshTerminalInput: (id: string, data: string) => window.api.sshTerminalInput(id, data),
  sshTerminalReplay: (id: string) => window.api.sshTerminalReplay(id),
  sshTerminalClose: (id: string) => window.api.sshTerminalClose(id),
  onSshTerminalEvent: (cb: (payload: SshTerminalEvent) => void) =>
    window.api.onSshTerminalEvent(cb),
  podExecStart: (
    id: string,
    context: string,
    namespace: string,
    pod: string,
    container: string,
    opts?: { cols?: number; rows?: number; shell?: string },
  ) => window.api.podExecStart(id, context, namespace, pod, container, opts),
  nodeExecStart: (
    id: string,
    context: string,
    node: string,
    opts?: { cols?: number; rows?: number },
  ) => window.api.nodeExecStart(id, context, node, opts),
  podExecHasSession: (id: string) => window.api.podExecHasSession(id),
  podExecDetach: (id: string) => window.api.podExecDetach(id),
  podExecCloseTabScope: (tabId: string, scope: string | null) =>
    window.api.podExecCloseTabScope(tabId, scope),
  podExecInput: (id: string, data: string) => window.api.podExecInput(id, data),
  podExecResize: (id: string, cols: number, rows: number) =>
    window.api.podExecResize(id, cols, rows),
  podExecReplay: (id: string) => window.api.podExecReplay(id),
  podExecClose: (id: string) => window.api.podExecClose(id),
  onPodExecEvent: (cb: (payload: PodExecEvent) => void) => window.api.onPodExecEvent(cb),
  onAgentPlanUpdated: (cb: (payload: { plan: Plan }) => void) => window.api.onAgentPlanUpdated(cb),
  k8sStartPortForward: (...args: Parameters<typeof window.api.k8sStartPortForward>) =>
    window.api.k8sStartPortForward(...args),
  k8sStartServicePortForward: (...args: Parameters<typeof window.api.k8sStartServicePortForward>) =>
    window.api.k8sStartServicePortForward(...args),
  k8sGetPodPortForwardOptions: (
    ...args: Parameters<typeof window.api.k8sGetPodPortForwardOptions>
  ) => window.api.k8sGetPodPortForwardOptions(...args),
  k8sGetServicePortForwardOptions: (
    ...args: Parameters<typeof window.api.k8sGetServicePortForwardOptions>
  ) => window.api.k8sGetServicePortForwardOptions(...args),
  k8sStopPortForward: (...args: Parameters<typeof window.api.k8sStopPortForward>) =>
    window.api.k8sStopPortForward(...args),
  k8sListPortForwards: () => window.api.k8sListPortForwards(),
  onPortForwardEvent: (cb: (e: PortForwardEvent) => void) => window.api.onPortForwardEvent(cb),
  k8sWatchSubscribe: (context: string, kind: K8sWatchKind, namespace: string | null) =>
    window.api.k8sWatchSubscribe(context, kind, namespace),
  k8sWatchUnsubscribe: (subscriptionId: string) => window.api.k8sWatchUnsubscribe(subscriptionId),
  k8sWatchRefresh: (context: string, kind: K8sWatchKind, namespace: string | null) =>
    window.api.k8sWatchRefresh(context, kind, namespace),
  onK8sWatchEvent: (cb: (payload: K8sWatchEvent) => void) => window.api.onK8sWatchEvent(cb),
}
