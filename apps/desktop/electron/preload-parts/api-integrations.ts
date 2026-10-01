import { ipcRenderer } from 'electron'

export const integrationsApi = {
  onAgentPlanUpdated: (cb: (payload: { plan: unknown }) => void) => {
    const handler = (_e: unknown, payload: { plan: unknown }) => cb(payload)

    ipcRenderer.on('agent:planUpdated', handler)

    return () => ipcRenderer.off('agent:planUpdated', handler)
  },
  // Untyped passthrough: the renderer-side WindowShellApi type (AppShortcutAction
  // in src/api/window-shell.ts) is the authoritative union for shortcut actions.
  onAppShortcut: (cb: (action: string) => void) => {
    const handler = (_e: unknown, action: string) => cb(action)

    ipcRenderer.on('app:shortcut', handler)

    return () => ipcRenderer.off('app:shortcut', handler)
  },
  k8sStartPortForward: (
    ctx: string,
    ns: string,
    pod: string,
    targetPort: number,
    localPort?: number,
  ) => ipcRenderer.invoke('k8s:startPortForward', ctx, ns, pod, targetPort, localPort),
  k8sStartServicePortForward: (
    ctx: string,
    ns: string,
    service: string,
    servicePort: number,
    localPort?: number,
  ) => ipcRenderer.invoke('k8s:startServicePortForward', ctx, ns, service, servicePort, localPort),
  k8sGetPodPortForwardOptions: (ctx: string, ns: string, pod: string) =>
    ipcRenderer.invoke('k8s:getPodPortForwardOptions', ctx, ns, pod),
  k8sGetServicePortForwardOptions: (ctx: string, ns: string, service: string) =>
    ipcRenderer.invoke('k8s:getServicePortForwardOptions', ctx, ns, service),
  k8sStopPortForward: (id: string) => ipcRenderer.invoke('k8s:stopPortForward', id),
  atlasListLinodeAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listLinodeAccounts', teamId),
  atlasBindLinodeAccount: (teamId: string, label: string, token: string) =>
    ipcRenderer.invoke('atlas:bindLinodeAccount', teamId, label, token),
  atlasUnbindLinodeAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindLinodeAccount', teamId, accountId),
  atlasListHetznerAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listHetznerAccounts', teamId),
  atlasBindHetznerAccount: (teamId: string, label: string, token: string) =>
    ipcRenderer.invoke('atlas:bindHetznerAccount', teamId, label, token),
  atlasUnbindHetznerAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindHetznerAccount', teamId, accountId),
  atlasListHetznerServers: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listHetznerServers', teamId, accountId),
  atlasListVantaIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listVantaIntegrations', teamId),
  atlasBindVantaIntegration: (
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string,
  ) => ipcRenderer.invoke('atlas:bindVantaIntegration', teamId, label, clientId, clientSecret),
  atlasUnbindVantaIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindVantaIntegration', teamId, integrationId),
  atlasListSecureframeIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listSecureframeIntegrations', teamId),
  atlasBindSecureframeIntegration: (
    teamId: string,
    label: string,
    region: 'us' | 'uk',
    apiKey: string,
    apiSecret: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:bindSecureframeIntegration',
      teamId,
      label,
      region,
      apiKey,
      apiSecret,
    ),
  atlasUnbindSecureframeIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindSecureframeIntegration', teamId, integrationId),
  atlasListSonarqubeIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listSonarqubeIntegrations', teamId),
  atlasListSonarqubeProjects: (
    teamId: string,
    integrationId: string,
    page?: number,
    pageSize?: number,
  ) => ipcRenderer.invoke('atlas:listSonarqubeProjects', teamId, integrationId, page, pageSize),
  atlasBindSonarqubeIntegration: (teamId: string, label: string, baseUrl: string, token: string) =>
    ipcRenderer.invoke('atlas:bindSonarqubeIntegration', teamId, label, baseUrl, token),
  atlasUnbindSonarqubeIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindSonarqubeIntegration', teamId, integrationId),
  atlasListSecureframeTests: (teamId: string, integrationId: string, failingOnly?: boolean) =>
    ipcRenderer.invoke('atlas:listSecureframeTests', teamId, integrationId, failingOnly),
  atlasListNotionIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listNotionIntegrations', teamId),
  atlasBindNotionIntegration: (teamId: string, label: string, token: string) =>
    ipcRenderer.invoke('atlas:bindNotionIntegration', teamId, label, token),
  atlasUnbindNotionIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindNotionIntegration', teamId, integrationId),
  atlasListUpstashAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listUpstashAccounts', teamId),
  atlasBindUpstashAccount: (teamId: string, label: string, email: string, apiKey: string) =>
    ipcRenderer.invoke('atlas:bindUpstashAccount', teamId, label, email, apiKey),
  atlasUnbindUpstashAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindUpstashAccount', teamId, accountId),
  atlasGetUpstashAccountAccess: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getUpstashAccountAccess', teamId, accountId),
  atlasUpdateUpstashAccountAccess: (teamId: string, accountId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updateUpstashAccountAccess', teamId, accountId, access),
  atlasGetTencentAccountAccess: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getTencentAccountAccess', teamId, accountId),
  atlasUpdateTencentAccountAccess: (teamId: string, accountId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updateTencentAccountAccess', teamId, accountId, access),
  atlasGetAliyunAccountAccess: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getAliyunAccountAccess', teamId, accountId),
  atlasUpdateAliyunAccountAccess: (teamId: string, accountId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updateAliyunAccountAccess', teamId, accountId, access),
  atlasGetVolcengineAccountAccess: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getVolcengineAccountAccess', teamId, accountId),
  atlasUpdateVolcengineAccountAccess: (teamId: string, accountId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updateVolcengineAccountAccess', teamId, accountId, access),
  atlasGetHuaweiAccountAccess: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getHuaweiAccountAccess', teamId, accountId),
  atlasUpdateHuaweiAccountAccess: (teamId: string, accountId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updateHuaweiAccountAccess', teamId, accountId, access),
  atlasGetBetterStackIntegrationAccess: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:getBetterStackIntegrationAccess', teamId, integrationId),
  atlasUpdateBetterStackIntegrationAccess: (
    teamId: string,
    integrationId: string,
    access: unknown,
  ) =>
    ipcRenderer.invoke('atlas:updateBetterStackIntegrationAccess', teamId, integrationId, access),
  atlasListResendIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listResendIntegrations', teamId),
  atlasBindResendIntegration: (teamId: string, label: string, apiKey: string) =>
    ipcRenderer.invoke('atlas:bindResendIntegration', teamId, label, apiKey),
  atlasUnbindResendIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindResendIntegration', teamId, integrationId),
  atlasListVantaTests: (
    teamId: string,
    integrationId: string,
    opts?: { status?: string; infraOnly?: boolean },
  ) => ipcRenderer.invoke('atlas:listVantaTests', teamId, integrationId, opts),
  atlasListTencentAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listTencentAccounts', teamId),
  atlasGetTencentOidcInfo: (teamId: string) =>
    ipcRenderer.invoke('atlas:getTencentOidcInfo', teamId),
  atlasBindTencentAccount: (
    teamId: string,
    label: string,
    site: string,
    roleArn: string,
    providerId: string,
  ) => ipcRenderer.invoke('atlas:bindTencentAccount', teamId, label, site, roleArn, providerId),
  atlasUnbindTencentAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindTencentAccount', teamId, accountId),
  atlasListTencentClusters: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listTencentClusters', teamId, accountId),
  atlasListTencentCvmInstances: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listTencentCvmInstances', teamId, accountId),
  atlasUseTencentCluster: (teamId: string, accountId: string, clusterId: string, region?: string) =>
    ipcRenderer.invoke('atlas:useTencentCluster', teamId, accountId, clusterId, region),
  atlasListAzureAccounts: (teamId: string) => ipcRenderer.invoke('atlas:listAzureAccounts', teamId),
  atlasGetAzureOidcInfo: (teamId: string) => ipcRenderer.invoke('atlas:getAzureOidcInfo', teamId),
  atlasGetGcpWifInfo: (teamId: string) => ipcRenderer.invoke('atlas:getGcpWifInfo', teamId),
  atlasBindAzureAccount: (
    teamId: string,
    label: string,
    tenantId: string,
    clientId: string,
    subscriptionId: string,
  ) =>
    ipcRenderer.invoke('atlas:bindAzureAccount', teamId, label, tenantId, clientId, subscriptionId),
  atlasUnbindAzureAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindAzureAccount', teamId, accountId),
  atlasListAzureClusters: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listAzureClusters', teamId, accountId),
  atlasListAzureRoleAssignments: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listAzureRoleAssignments', teamId, accountId),
  atlasGetAzureAccountAccess: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getAzureAccountAccess', teamId, accountId),
  atlasUpdateAzureAccountAccess: (
    teamId: string,
    accountId: string,
    access: { memberAllowList?: string[] },
  ) => ipcRenderer.invoke('atlas:updateAzureAccountAccess', teamId, accountId, access),
  atlasUseAzureCluster: (
    teamId: string,
    accountId: string,
    clusterName: string,
    resourceGroup?: string,
  ) => ipcRenderer.invoke('atlas:useAzureCluster', teamId, accountId, clusterName, resourceGroup),
  atlasListAliyunAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listAliyunAccounts', teamId),
  atlasGetAliyunOidcInfo: (teamId: string) => ipcRenderer.invoke('atlas:getAliyunOidcInfo', teamId),
  atlasBindAliyunAccount: (
    teamId: string,
    label: string,
    site: string,
    roleArn: string,
    oidcProviderArn: string,
  ) => ipcRenderer.invoke('atlas:bindAliyunAccount', teamId, label, site, roleArn, oidcProviderArn),
  atlasUnbindAliyunAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindAliyunAccount', teamId, accountId),
  atlasListAliyunClusters: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listAliyunClusters', teamId, accountId),
  atlasListAliyunEcsInstances: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listAliyunEcsInstances', teamId, accountId),
  atlasListAliyunSwasInstances: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listAliyunSwasInstances', teamId, accountId),
  atlasUseAliyunCluster: (teamId: string, accountId: string, clusterId: string, region?: string) =>
    ipcRenderer.invoke('atlas:useAliyunCluster', teamId, accountId, clusterId, region),
  atlasListVolcengineAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listVolcengineAccounts', teamId),
  atlasGetVolcengineOidcInfo: (teamId: string) =>
    ipcRenderer.invoke('atlas:getVolcengineOidcInfo', teamId),
  atlasBindVolcengineAccount: (teamId: string, label: string, roleTrn: string) =>
    ipcRenderer.invoke('atlas:bindVolcengineAccount', teamId, label, roleTrn),
  atlasUnbindVolcengineAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindVolcengineAccount', teamId, accountId),
  atlasListHuaweiAccounts: (teamId: string) =>
    ipcRenderer.invoke('atlas:listHuaweiAccounts', teamId),
  atlasGetHuaweiOidcInfo: (teamId: string) => ipcRenderer.invoke('atlas:getHuaweiOidcInfo', teamId),
  atlasBindHuaweiAccount: (
    teamId: string,
    label: string,
    domainId: string,
    idpId: string,
    agencyName: string,
  ) => ipcRenderer.invoke('atlas:bindHuaweiAccount', teamId, label, domainId, idpId, agencyName),
  atlasUnbindHuaweiAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindHuaweiAccount', teamId, accountId),
  atlasListVolcengineClusters: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listVolcengineClusters', teamId, accountId),
  atlasListVolcengineEcsInstances: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listVolcengineEcsInstances', teamId, accountId),
  atlasUseVolcengineCluster: (
    teamId: string,
    accountId: string,
    clusterId: string,
    region?: string,
    fresh?: boolean,
  ) =>
    ipcRenderer.invoke('atlas:useVolcengineCluster', teamId, accountId, clusterId, region, fresh),
  atlasListTailscaleClients: (teamId: string) =>
    ipcRenderer.invoke('atlas:listTailscaleClients', teamId),
}
