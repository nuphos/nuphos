import { ipcRenderer } from 'electron'

export const connectApi = {
  atlasBindTailscaleClient: (
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string | null,
    federated?: boolean,
  ) =>
    ipcRenderer.invoke(
      'atlas:bindTailscaleClient',
      teamId,
      label,
      clientId,
      clientSecret,
      federated,
    ),
  atlasUnbindTailscaleClient: (teamId: string, clientId: string) =>
    ipcRenderer.invoke('atlas:unbindTailscaleClient', teamId, clientId),
  atlasListTailscaleDevices: (teamId: string, clientId: string) =>
    ipcRenderer.invoke('atlas:listTailscaleDevices', teamId, clientId),
  atlasSetTailscaleSandboxAccess: (
    teamId: string,
    clientId: string,
    enabled: boolean,
    tag: string,
  ) => ipcRenderer.invoke('atlas:setTailscaleSandboxAccess', teamId, clientId, enabled, tag),
  atlasGenerateTailscaleAclSnippet: (
    teamId: string,
    clientId: string,
    targetTag: string,
    sshUsers: string[],
    recorderTag?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:generateTailscaleAclSnippet',
      teamId,
      clientId,
      targetTag,
      sshUsers,
      recorderTag,
    ),
  atlasListZeaburProviders: (teamId: string) =>
    ipcRenderer.invoke('atlas:listZeaburProviders', teamId),
  atlasBindZeaburProvider: (teamId: string, token: string) =>
    ipcRenderer.invoke('atlas:bindZeaburProvider', teamId, token),
  atlasUnbindZeaburProvider: (teamId: string, zeaburId: string) =>
    ipcRenderer.invoke('atlas:unbindZeaburProvider', teamId, zeaburId),
  atlasListZeaburProjects: (teamId: string, zeaburId: string) =>
    ipcRenderer.invoke('atlas:listZeaburProjects', teamId, zeaburId),
  atlasListZeaburServers: (teamId: string, zeaburId: string) =>
    ipcRenderer.invoke('atlas:listZeaburServers', teamId, zeaburId),
  atlasListLinodeInstances: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listLinodeInstances', teamId, accountId),
  atlasListLkeClusters: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listLkeClusters', teamId, accountId),
  atlasUseLinodeCluster: (
    teamId: string,
    accountId: string,
    clusterId: number,
    clusterLabel: string,
  ) => ipcRenderer.invoke('atlas:useLinodeCluster', teamId, accountId, clusterId, clusterLabel),
  useClusterViaEndpoint: (host: string, clusterLabel: string) =>
    ipcRenderer.invoke('k8s:useClusterViaEndpoint', host, clusterLabel),
  k8sListPortForwards: () => ipcRenderer.invoke('k8s:listPortForwards'),
  onPortForwardEvent: (cb: (payload: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => cb(payload)

    ipcRenderer.on('k8s:portforward:event', handler)

    return () => ipcRenderer.removeListener('k8s:portforward:event', handler)
  },
  k8sWatchSubscribe: (context: string, kind: string, namespace: string | null) =>
    ipcRenderer.invoke('k8s:watch:subscribe', { context, kind, namespace }),
  k8sWatchUnsubscribe: (subscriptionId: string) =>
    ipcRenderer.invoke('k8s:watch:unsubscribe', subscriptionId),
  k8sWatchRefresh: (context: string, kind: string, namespace: string | null) =>
    ipcRenderer.invoke('k8s:watch:refresh', { context, kind, namespace }),
  onK8sWatchEvent: (cb: (payload: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => cb(payload)

    ipcRenderer.on('k8s:watch:event', handler)

    return () => ipcRenderer.removeListener('k8s:watch:event', handler)
  },
}
