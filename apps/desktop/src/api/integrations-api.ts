import type { BindingAccess } from '../types/k8s-core.ts'
import type { AliyunSite, TencentSite } from '../types/provider-accounts.ts'

export const integrationsApi = {
  atlasListLinodeAccounts: (teamId: string) => window.api.atlasListLinodeAccounts(teamId),
  atlasBindLinodeAccount: (teamId: string, label: string, token: string) =>
    window.api.atlasBindLinodeAccount(teamId, label, token),
  atlasUnbindLinodeAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindLinodeAccount(teamId, accountId),
  atlasListHetznerAccounts: (teamId: string) => window.api.atlasListHetznerAccounts(teamId),
  atlasBindHetznerAccount: (teamId: string, label: string, token: string) =>
    window.api.atlasBindHetznerAccount(teamId, label, token),
  atlasUnbindHetznerAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindHetznerAccount(teamId, accountId),
  atlasListHetznerServers: (teamId: string, accountId: string) =>
    window.api.atlasListHetznerServers(teamId, accountId),
  atlasListVantaIntegrations: (teamId: string) => window.api.atlasListVantaIntegrations(teamId),
  atlasBindVantaIntegration: (
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string,
  ) => window.api.atlasBindVantaIntegration(teamId, label, clientId, clientSecret),
  atlasUnbindVantaIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindVantaIntegration(teamId, integrationId),
  atlasListSecureframeIntegrations: (teamId: string) =>
    window.api.atlasListSecureframeIntegrations(teamId),
  atlasBindSecureframeIntegration: (
    teamId: string,
    label: string,
    region: 'us' | 'uk',
    apiKey: string,
    apiSecret: string,
  ) => window.api.atlasBindSecureframeIntegration(teamId, label, region, apiKey, apiSecret),
  atlasUnbindSecureframeIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindSecureframeIntegration(teamId, integrationId),
  atlasListSonarqubeIntegrations: (teamId: string) =>
    window.api.atlasListSonarqubeIntegrations(teamId),
  atlasListSonarqubeProjects: (
    teamId: string,
    integrationId: string,
    page?: number,
    pageSize?: number,
  ) => window.api.atlasListSonarqubeProjects(teamId, integrationId, page, pageSize),
  atlasBindSonarqubeIntegration: (teamId: string, label: string, baseUrl: string, token: string) =>
    window.api.atlasBindSonarqubeIntegration(teamId, label, baseUrl, token),
  atlasUnbindSonarqubeIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindSonarqubeIntegration(teamId, integrationId),
  atlasListSecureframeTests: (teamId: string, integrationId: string, failingOnly?: boolean) =>
    window.api.atlasListSecureframeTests(teamId, integrationId, failingOnly),
  atlasListNotionIntegrations: (teamId: string) => window.api.atlasListNotionIntegrations(teamId),
  atlasBindNotionIntegration: (teamId: string, label: string, token: string) =>
    window.api.atlasBindNotionIntegration(teamId, label, token),
  atlasUnbindNotionIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindNotionIntegration(teamId, integrationId),
  atlasListUpstashAccounts: (teamId: string) => window.api.atlasListUpstashAccounts(teamId),
  atlasBindUpstashAccount: (teamId: string, label: string, email: string, apiKey: string) =>
    window.api.atlasBindUpstashAccount(teamId, label, email, apiKey),
  atlasUnbindUpstashAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindUpstashAccount(teamId, accountId),
  atlasGetUpstashAccountAccess: (teamId: string, accountId: string) =>
    window.api.atlasGetUpstashAccountAccess(teamId, accountId),
  atlasUpdateUpstashAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateUpstashAccountAccess(teamId, accountId, access),
  atlasGetTencentAccountAccess: (teamId: string, accountId: string) =>
    window.api.atlasGetTencentAccountAccess(teamId, accountId),
  atlasUpdateTencentAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateTencentAccountAccess(teamId, accountId, access),
  atlasGetAliyunAccountAccess: (teamId: string, accountId: string) =>
    window.api.atlasGetAliyunAccountAccess(teamId, accountId),
  atlasUpdateAliyunAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateAliyunAccountAccess(teamId, accountId, access),
  atlasGetVolcengineAccountAccess: (teamId: string, accountId: string) =>
    window.api.atlasGetVolcengineAccountAccess(teamId, accountId),
  atlasUpdateVolcengineAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateVolcengineAccountAccess(teamId, accountId, access),
  atlasGetHuaweiAccountAccess: (teamId: string, accountId: string) =>
    window.api.atlasGetHuaweiAccountAccess(teamId, accountId),
  atlasUpdateHuaweiAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateHuaweiAccountAccess(teamId, accountId, access),
  atlasGetBetterStackIntegrationAccess: (teamId: string, integrationId: string) =>
    window.api.atlasGetBetterStackIntegrationAccess(teamId, integrationId),
  atlasUpdateBetterStackIntegrationAccess: (
    teamId: string,
    integrationId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateBetterStackIntegrationAccess(teamId, integrationId, access),
  atlasListResendIntegrations: (teamId: string) => window.api.atlasListResendIntegrations(teamId),
  atlasBindResendIntegration: (teamId: string, label: string, apiKey: string) =>
    window.api.atlasBindResendIntegration(teamId, label, apiKey),
  atlasUnbindResendIntegration: (teamId: string, integrationId: string) =>
    window.api.atlasUnbindResendIntegration(teamId, integrationId),
  atlasListVantaTests: (
    teamId: string,
    integrationId: string,
    opts?: { status?: string; infraOnly?: boolean },
  ) => window.api.atlasListVantaTests(teamId, integrationId, opts),
  atlasListTencentAccounts: (teamId: string) => window.api.atlasListTencentAccounts(teamId),
  atlasGetTencentOidcInfo: (teamId: string) => window.api.atlasGetTencentOidcInfo(teamId),
  atlasBindTencentAccount: (
    teamId: string,
    label: string,
    site: TencentSite,
    roleArn: string,
    providerId: string,
  ) => window.api.atlasBindTencentAccount(teamId, label, site, roleArn, providerId),
  atlasUnbindTencentAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindTencentAccount(teamId, accountId),
  atlasListTencentClusters: (teamId: string, accountId: string) =>
    window.api.atlasListTencentClusters(teamId, accountId),
  atlasListTencentCvmInstances: (teamId: string, accountId: string) =>
    window.api.atlasListTencentCvmInstances(teamId, accountId),
  atlasListAliyunAccounts: (teamId: string) => window.api.atlasListAliyunAccounts(teamId),
  atlasGetAliyunOidcInfo: (teamId: string) => window.api.atlasGetAliyunOidcInfo(teamId),
  atlasBindAliyunAccount: (
    teamId: string,
    label: string,
    site: AliyunSite,
    roleArn: string,
    oidcProviderArn: string,
  ) => window.api.atlasBindAliyunAccount(teamId, label, site, roleArn, oidcProviderArn),
  atlasUnbindAliyunAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindAliyunAccount(teamId, accountId),
  atlasListAliyunClusters: (teamId: string, accountId: string) =>
    window.api.atlasListAliyunClusters(teamId, accountId),
  atlasListAliyunEcsInstances: (teamId: string, accountId: string) =>
    window.api.atlasListAliyunEcsInstances(teamId, accountId),
  atlasListAliyunSwasInstances: (teamId: string, accountId: string) =>
    window.api.atlasListAliyunSwasInstances(teamId, accountId),
  atlasListVolcengineAccounts: (teamId: string) => window.api.atlasListVolcengineAccounts(teamId),
  atlasGetVolcengineOidcInfo: (teamId: string) => window.api.atlasGetVolcengineOidcInfo(teamId),
  atlasBindVolcengineAccount: (teamId: string, label: string, roleTrn: string) =>
    window.api.atlasBindVolcengineAccount(teamId, label, roleTrn),
  atlasUnbindVolcengineAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindVolcengineAccount(teamId, accountId),
  atlasListHuaweiAccounts: (teamId: string) => window.api.atlasListHuaweiAccounts(teamId),
  atlasGetHuaweiOidcInfo: (teamId: string) => window.api.atlasGetHuaweiOidcInfo(teamId),
  atlasBindHuaweiAccount: (
    teamId: string,
    label: string,
    domainId: string,
    idpId: string,
    agencyName: string,
  ) => window.api.atlasBindHuaweiAccount(teamId, label, domainId, idpId, agencyName),
  atlasUnbindHuaweiAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindHuaweiAccount(teamId, accountId),
  atlasListVolcengineClusters: (teamId: string, accountId: string) =>
    window.api.atlasListVolcengineClusters(teamId, accountId),
  atlasListVolcengineEcsInstances: (teamId: string, accountId: string) =>
    window.api.atlasListVolcengineEcsInstances(teamId, accountId),
  atlasListAzureAccounts: (teamId: string) => window.api.atlasListAzureAccounts(teamId),
  atlasGetAzureOidcInfo: (teamId: string) => window.api.atlasGetAzureOidcInfo(teamId),
  atlasGetGcpWifInfo: (teamId: string) => window.api.atlasGetGcpWifInfo(teamId),
  atlasBindAzureAccount: (
    teamId: string,
    label: string,
    tenantId: string,
    clientId: string,
    subscriptionId: string,
  ) => window.api.atlasBindAzureAccount(teamId, label, tenantId, clientId, subscriptionId),
  atlasUnbindAzureAccount: (teamId: string, accountId: string) =>
    window.api.atlasUnbindAzureAccount(teamId, accountId),
  atlasListAzureClusters: (teamId: string, accountId: string) =>
    window.api.atlasListAzureClusters(teamId, accountId),
  atlasListAzureRoleAssignments: (teamId: string, accountId: string) =>
    window.api.atlasListAzureRoleAssignments(teamId, accountId),
  atlasGetAzureAccountAccess: (teamId: string, accountId: string) =>
    window.api.atlasGetAzureAccountAccess(teamId, accountId),
  atlasUpdateAzureAccountAccess: (
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ) => window.api.atlasUpdateAzureAccountAccess(teamId, accountId, access),
  atlasUseAzureCluster: (
    teamId: string,
    accountId: string,
    clusterName: string,
    resourceGroup?: string,
  ) => window.api.atlasUseAzureCluster(teamId, accountId, clusterName, resourceGroup),
  atlasListTailscaleClients: (teamId: string) => window.api.atlasListTailscaleClients(teamId),
  atlasBindTailscaleClient: (
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string | null,
    federated?: boolean,
  ) => window.api.atlasBindTailscaleClient(teamId, label, clientId, clientSecret, federated),
  atlasUnbindTailscaleClient: (teamId: string, clientId: string) =>
    window.api.atlasUnbindTailscaleClient(teamId, clientId),
  atlasListTailscaleDevices: (teamId: string, clientId: string) =>
    window.api.atlasListTailscaleDevices(teamId, clientId),
  atlasSetTailscaleSandboxAccess: (
    teamId: string,
    clientId: string,
    enabled: boolean,
    tag: string,
  ) => window.api.atlasSetTailscaleSandboxAccess(teamId, clientId, enabled, tag),
  atlasGenerateTailscaleAclSnippet: (
    teamId: string,
    clientId: string,
    targetTag: string,
    sshUsers: string[],
    recorderTag?: string,
  ) =>
    window.api.atlasGenerateTailscaleAclSnippet(teamId, clientId, targetTag, sshUsers, recorderTag),
  atlasListZeaburProviders: (teamId: string) => window.api.atlasListZeaburProviders(teamId),
  atlasBindZeaburProvider: (teamId: string, token: string) =>
    window.api.atlasBindZeaburProvider(teamId, token),
  atlasUnbindZeaburProvider: (teamId: string, zeaburId: string) =>
    window.api.atlasUnbindZeaburProvider(teamId, zeaburId),
  atlasListZeaburProjects: (teamId: string, zeaburId: string) =>
    window.api.atlasListZeaburProjects(teamId, zeaburId),
  atlasListZeaburServers: (teamId: string, zeaburId: string) =>
    window.api.atlasListZeaburServers(teamId, zeaburId),
  atlasListLinodeInstances: (teamId: string, accountId: string) =>
    window.api.atlasListLinodeInstances(teamId, accountId),
  atlasListLkeClusters: (teamId: string, accountId: string) =>
    window.api.atlasListLkeClusters(teamId, accountId),
  atlasUseLinodeCluster: (
    teamId: string,
    accountId: string,
    clusterId: number,
    clusterLabel: string,
  ) => window.api.atlasUseLinodeCluster(teamId, accountId, clusterId, clusterLabel),
  useClusterViaEndpoint: (host: string, clusterLabel: string) =>
    window.api.useClusterViaEndpoint(host, clusterLabel),
}
