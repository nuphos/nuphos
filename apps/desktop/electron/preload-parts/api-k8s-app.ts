import { ipcRenderer, webFrame, webUtils } from 'electron'

import type { CustomResourceDescriptor } from '../k8s'

type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet'

type DeepLinkEnvelope = { deliveryId: number; payload: unknown }

/**
 * Deep-link ids already handed to the renderer. Main keeps re-sending a payload
 * until this preload acks it, which is the only proof a listener existed; the
 * ids guard against acting twice when an ack and a retry cross paths. Module
 * scope on purpose — the renderer re-subscribes on every dependency change.
 */
const handedOverDeepLinks = new Set<number>()
const MAX_REMEMBERED_DEEP_LINKS = 100

function rememberDeepLink(deliveryId: number) {
  for (const oldest of handedOverDeepLinks) {
    if (handedOverDeepLinks.size < MAX_REMEMBERED_DEEP_LINKS) break
    handedOverDeepLinks.delete(oldest)
  }
  handedOverDeepLinks.add(deliveryId)
}

function subscribeDeepLink(channel: string, cb: (payload: unknown) => void) {
  const handler = (_e: unknown, envelope: DeepLinkEnvelope) => {
    ipcRenderer.send('deep-link:ack', envelope.deliveryId)
    if (handedOverDeepLinks.has(envelope.deliveryId)) return
    rememberDeepLink(envelope.deliveryId)
    cb(envelope.payload)
  }

  ipcRenderer.on(channel, handler)
  // Nothing is queued most of the time; when something is, this saves it a
  // retry interval of waiting.
  ipcRenderer.send('deep-link:subscriber-ready')

  return () => ipcRenderer.off(channel, handler)
}

export const k8sAppApi = {
  listContexts: () => ipcRenderer.invoke('k8s:listContexts'),
  probeClusterAccess: (ctx: string) => ipcRenderer.invoke('k8s:probeClusterAccess', ctx),
  listNamespaceNames: (ctx: string) => ipcRenderer.invoke('k8s:listNamespaceNames', ctx),
  listNamespaces: (ctx: string) => ipcRenderer.invoke('k8s:listNamespaces', ctx),
  listPods: (ctx: string, ns: string | null) => ipcRenderer.invoke('k8s:listPods', ctx, ns),
  listDeployments: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listDeployments', ctx, ns),
  listNodes: (ctx: string) => ipcRenderer.invoke('k8s:listNodes', ctx),
  listContainerUsage: (ctx: string) => ipcRenderer.invoke('k8s:listContainerUsage', ctx),
  listServices: (ctx: string, ns: string | null) => ipcRenderer.invoke('k8s:listServices', ctx, ns),
  listReplicaSets: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listReplicaSets', ctx, ns),
  listStatefulSets: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listStatefulSets', ctx, ns),
  listDaemonSets: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listDaemonSets', ctx, ns),
  listJobs: (ctx: string, ns: string | null) => ipcRenderer.invoke('k8s:listJobs', ctx, ns),
  listCronJobs: (ctx: string, ns: string | null) => ipcRenderer.invoke('k8s:listCronJobs', ctx, ns),
  getCronJobDetail: (ctx: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:getCronJobDetail', ctx, ns, name),
  listIngresses: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listIngresses', ctx, ns),
  listNetworkPolicies: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listNetworkPolicies', ctx, ns),
  listEndpointSlices: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listEndpointSlices', ctx, ns),
  listConfigMaps: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listConfigMaps', ctx, ns),
  listSecrets: (ctx: string, ns: string | null) => ipcRenderer.invoke('k8s:listSecrets', ctx, ns),
  listStorageClasses: (ctx: string) => ipcRenderer.invoke('k8s:listStorageClasses', ctx),
  listServiceAccounts: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listServiceAccounts', ctx, ns),
  listRoles: (ctx: string, ns: string | null) => ipcRenderer.invoke('k8s:listRoles', ctx, ns),
  listRoleBindings: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listRoleBindings', ctx, ns),
  listClusterRoles: (ctx: string) => ipcRenderer.invoke('k8s:listClusterRoles', ctx),
  listClusterRoleBindings: (ctx: string) => ipcRenderer.invoke('k8s:listClusterRoleBindings', ctx),
  listPersistentVolumes: (ctx: string) => ipcRenderer.invoke('k8s:listPersistentVolumes', ctx),
  listPersistentVolumeClaims: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listPersistentVolumeClaims', ctx, ns),
  listHelmReleases: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listHelmReleases', ctx, ns),
  listCustomResourceDefinitions: (ctx: string) =>
    ipcRenderer.invoke('k8s:listCustomResourceDefinitions', ctx),
  listCustomResources: (ctx: string, ns: string | null) =>
    ipcRenderer.invoke('k8s:listCustomResources', ctx, ns),
  listCustomResourceType: (ctx: string, ns: string | null, resource: CustomResourceDescriptor) =>
    ipcRenderer.invoke('k8s:listCustomResourceType', ctx, ns, resource),
  deletePod: (ctx: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:deletePod', ctx, ns, name),
  deleteResource: (
    ctx: string,
    kind: string,
    ns: string | null,
    name: string,
    apiVersion?: string,
  ) => ipcRenderer.invoke('k8s:deleteResource', ctx, kind, ns, name, apiVersion),
  uninstallHelmRelease: (ctx: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:uninstallHelmRelease', ctx, ns, name),
  cordonNode: (ctx: string, name: string, cordoned: boolean) =>
    ipcRenderer.invoke('k8s:cordonNode', ctx, name, cordoned),
  restartDeployment: (ctx: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:restartDeployment', ctx, ns, name),
  restartWorkload: (ctx: string, kind: WorkloadKind, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:restartWorkload', ctx, kind, ns, name),
  scaleDeployment: (ctx: string, ns: string, name: string, replicas: number) =>
    ipcRenderer.invoke('k8s:scaleDeployment', ctx, ns, name, replicas),
  getDeploymentEnv: (ctx: string, kind: WorkloadKind, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:getDeploymentEnv', ctx, kind, ns, name),
  updateDeploymentContainerEnv: (
    ctx: string,
    kind: WorkloadKind,
    ns: string,
    name: string,
    containerType: 'containers' | 'initContainers',
    containerName: string,
    input: unknown,
  ) =>
    ipcRenderer.invoke(
      'k8s:updateDeploymentContainerEnv',
      ctx,
      kind,
      ns,
      name,
      containerType,
      containerName,
      input,
    ),
  getCronJobTriggerInfo: (ctx: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:getCronJobTriggerInfo', ctx, ns, name),
  triggerCronJob: (ctx: string, ns: string, name: string, jobName: string) =>
    ipcRenderer.invoke('k8s:triggerCronJob', ctx, ns, name, jobName),
  setCronJobSuspend: (ctx: string, ns: string, name: string, suspend: boolean) =>
    ipcRenderer.invoke('k8s:setCronJobSuspend', ctx, ns, name, suspend),
  upsertConfigMapKey: (
    ctx: string,
    ns: string,
    name: string,
    key: string,
    value: string,
    source: 'data' | 'binaryData' = 'data',
  ) => ipcRenderer.invoke('k8s:upsertConfigMapKey', ctx, ns, name, key, value, source),
  removeConfigMapKey: (
    ctx: string,
    ns: string,
    name: string,
    key: string,
    source: 'data' | 'binaryData',
  ) => ipcRenderer.invoke('k8s:removeConfigMapKey', ctx, ns, name, key, source),
  upsertSecretKey: (ctx: string, ns: string, name: string, key: string, value: string) =>
    ipcRenderer.invoke('k8s:upsertSecretKey', ctx, ns, name, key, value),
  removeSecretKey: (ctx: string, ns: string, name: string, key: string) =>
    ipcRenderer.invoke('k8s:removeSecretKey', ctx, ns, name, key),
  getPodDetail: (ctx: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:getPodDetail', ctx, ns, name),
  getNodeDetail: (ctx: string, name: string) => ipcRenderer.invoke('k8s:getNodeDetail', ctx, name),
  getPodLogs: (
    ctx: string,
    ns: string,
    name: string,
    container: string | null,
    query: import('../k8s').LogQuery,
  ) => ipcRenderer.invoke('k8s:getPodLogs', ctx, ns, name, container, query),
  getWorkloadSelector: (ctx: string, kind: string, ns: string, name: string) =>
    ipcRenderer.invoke('k8s:getWorkloadSelector', ctx, kind, ns, name),
  startWorkloadLogStream: (
    ctx: string,
    kind: string,
    ns: string,
    name: string,
    query: import('../k8s').LogQuery,
  ) => ipcRenderer.invoke('k8s:startWorkloadLogStream', ctx, kind, ns, name, query),
  stopWorkloadLogStream: (sessionId: string) =>
    ipcRenderer.invoke('k8s:stopWorkloadLogStream', sessionId),
  getWorkloadPreviousLogs: (
    ctx: string,
    kind: string,
    ns: string,
    name: string,
    query: import('../k8s').LogQuery,
  ) => ipcRenderer.invoke('k8s:getWorkloadPreviousLogs', ctx, kind, ns, name, query),
  onWorkloadLogEvent: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload)

    ipcRenderer.on('k8s:workloadlog:event', handler)

    return () => ipcRenderer.removeListener('k8s:workloadlog:event', handler)
  },
  getResourceYaml: (
    ctx: string,
    kind: string,
    ns: string | null,
    name: string,
    apiVersion?: string,
    plural?: string,
  ) => ipcRenderer.invoke('k8s:getResourceYaml', ctx, kind, ns, name, apiVersion, plural),
  applyResourceYaml: (
    ctx: string,
    yamlText: string,
    expected: { apiVersion: string; kind: string; name: string; namespace: string | null },
  ) => ipcRenderer.invoke('k8s:applyResourceYaml', ctx, yamlText, expected),
  listEvents: (
    ctx: string,
    ns: string | null,
    involvedKind: string | null,
    involvedName: string | null,
    involvedApiVersion?: string | null,
    involvedUid?: string | null,
    eventType?: string | null,
  ) =>
    ipcRenderer.invoke(
      'k8s:listEvents',
      ctx,
      ns,
      involvedKind,
      involvedName,
      involvedApiVersion,
      involvedUid,
      eventType,
    ),
  authUpdateProfile: (input: { name: string; username: string; avatarURL: string }) =>
    ipcRenderer.invoke('auth:updateProfile', input),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogin: () => ipcRenderer.invoke('auth:login'),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authCancel: () => ipcRenderer.invoke('auth:cancel'),
  authEmailRequestCode: (email: string) => ipcRenderer.invoke('auth:emailRequestCode', email),
  authEmailVerifyCode: (email: string, code: string) =>
    ipcRenderer.invoke('auth:emailVerifyCode', email, code),
  analyticsIdentify: (userId: string, props?: Record<string, unknown>) =>
    ipcRenderer.invoke('analytics:identify', userId, props),
  analyticsSetTeam: (teamId: string | null) => ipcRenderer.invoke('analytics:setTeam', teamId),
  appGetVersion: () => ipcRenderer.invoke('app:getVersion'),
  appSetApiEndpoint: (url: string | null) => ipcRenderer.invoke('app:setApiEndpoint', url),
  appGetPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  appSetNativeTheme: (source: 'system' | 'light' | 'dark') =>
    ipcRenderer.invoke('app:setNativeTheme', source),
  onNativeThemeUpdated: (cb: (payload: { shouldUseDarkColors: boolean }) => void) => {
    const handler = (_e: unknown, payload: { shouldUseDarkColors: boolean }) => cb(payload)

    ipcRenderer.on('app:nativeThemeUpdated', handler)

    return () => ipcRenderer.off('app:nativeThemeUpdated', handler)
  },
  // Current page zoom factor (cmd +/-) — the CSS counter-scales the traffic-
  // light insets by it.
  getZoomFactor: () => webFrame.getZoomFactor(),
  // Ping main after a page-zoom change so it can move the native traffic lights
  // vertically to track the zoomed titlebar row.
  notifyZoom: () => ipcRenderer.send('app:zoomChanged'),
  appHideWindow: () => ipcRenderer.invoke('app:hideWindow'),
  listAgentChatSkills: () => ipcRenderer.invoke('agent-chat:listSkills'),
  installAgentChatSkill: (target: 'claude' | 'codex', skillId: string) =>
    ipcRenderer.invoke('agent-chat:installSkill', target, skillId),
  uninstallAgentChatSkill: (target: 'claude' | 'codex', skillId: string) =>
    ipcRenderer.invoke('agent-chat:uninstallSkill', target, skillId),
  openAgentChatSkillsFolder: (target: 'claude' | 'codex') =>
    ipcRenderer.invoke('agent-chat:openSkillsFolder', target),
  onAgentChatDeepLink: (cb: (payload: unknown) => void) =>
    subscribeDeepLink('deep-link:agent-chat', cb),
  onAppOpenDeepLink: (cb: (payload: unknown) => void) =>
    subscribeDeepLink('deep-link:app-open', cb),
  onConnectAgentDeepLink: (cb: (payload: unknown) => void) =>
    subscribeDeepLink('deep-link:connect-agent', cb),
  onAgentFocusSession: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload)

    ipcRenderer.on('agent:focus-session', handler)

    return () => ipcRenderer.off('agent:focus-session', handler)
  },
  selectLocalFile: () => ipcRenderer.invoke('dialog:selectLocalFile'),
  selectLocalFolder: () => ipcRenderer.invoke('dialog:selectLocalFolder'),
  saveTextFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke('dialog:saveTextFile', { defaultPath, content }),
  listLocalAgentSessions: (source: 'claude-code' | 'codex') =>
    ipcRenderer.invoke('dialog:listLocalAgentSessions', source),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  savePastedAttachments: (payload: {
    paths: string[]
    files: { name: string; type: string; bytes: ArrayBuffer }[]
  }) => ipcRenderer.invoke('clipboard:savePastedAttachments', payload),
  updaterGetState: () => ipcRenderer.invoke('updater:getState'),
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
}
