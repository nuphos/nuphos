import type {
  AliyunEcsInstance,
  AliyunSwasInstance,
  TencentCvmInstance,
  VolcengineEcsInstance,
} from '../types/compute.ts'
import type {
  HetznerServer,
  LinodeInstance,
  LkeCluster,
  TailscaleDevice,
  TailscaleOAuthClient,
  ZeaburProject,
  ZeaburProvider,
  ZeaburServer,
} from '../types/infra-integrations.ts'
import type { BindingAccess } from '../types/k8s-core.ts'
import type {
  AliyunAccount,
  AliyunOidcInfo,
  AliyunSite,
  AtlasCluster,
  AzureAccount,
  AzureOidcInfo,
  AzureRoleAssignment,
  GcpWifInfo,
  HetznerAccount,
  HuaweiAccount,
  HuaweiOidcInfo,
  LinodeAccount,
  NotionIntegration,
  ResendIntegration,
  SecureframeIntegration,
  SecureframeTest,
  SonarqubeIntegration,
  SonarqubeProjectsPage,
  TencentAccount,
  TencentOidcInfo,
  TencentSite,
  UpstashAccount,
  VantaIntegration,
  VantaTest,
  VolcengineAccount,
  VolcengineOidcInfo,
} from '../types/provider-accounts.ts'

export type WindowIntegrationsApi = {
  atlasListLinodeAccounts(teamId: string): Promise<LinodeAccount[]>
  atlasBindLinodeAccount(teamId: string, label: string, token: string): Promise<LinodeAccount>
  atlasUnbindLinodeAccount(teamId: string, accountId: string): Promise<void>
  atlasListHetznerAccounts(teamId: string): Promise<HetznerAccount[]>
  atlasBindHetznerAccount(teamId: string, label: string, token: string): Promise<HetznerAccount>
  atlasUnbindHetznerAccount(teamId: string, accountId: string): Promise<void>
  atlasListHetznerServers(teamId: string, accountId: string): Promise<HetznerServer[]>
  atlasListVantaIntegrations(teamId: string): Promise<VantaIntegration[]>
  atlasBindVantaIntegration(
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string,
  ): Promise<VantaIntegration>
  atlasUnbindVantaIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListSecureframeIntegrations(teamId: string): Promise<SecureframeIntegration[]>
  atlasBindSecureframeIntegration(
    teamId: string,
    label: string,
    region: 'us' | 'uk',
    apiKey: string,
    apiSecret: string,
  ): Promise<SecureframeIntegration>
  atlasUnbindSecureframeIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListSonarqubeIntegrations(teamId: string): Promise<SonarqubeIntegration[]>
  atlasListSonarqubeProjects(
    teamId: string,
    integrationId: string,
    page?: number,
    pageSize?: number,
  ): Promise<SonarqubeProjectsPage>
  atlasBindSonarqubeIntegration(
    teamId: string,
    label: string,
    baseUrl: string,
    token: string,
  ): Promise<SonarqubeIntegration>
  atlasUnbindSonarqubeIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListSecureframeTests(
    teamId: string,
    integrationId: string,
    failingOnly?: boolean,
  ): Promise<SecureframeTest[]>
  atlasListNotionIntegrations(teamId: string): Promise<NotionIntegration[]>
  atlasBindNotionIntegration(
    teamId: string,
    label: string,
    token: string,
  ): Promise<NotionIntegration>
  atlasUnbindNotionIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListUpstashAccounts(teamId: string): Promise<UpstashAccount[]>
  atlasBindUpstashAccount(
    teamId: string,
    label: string,
    email: string,
    apiKey: string,
  ): Promise<UpstashAccount>
  atlasUnbindUpstashAccount(teamId: string, accountId: string): Promise<void>
  atlasGetUpstashAccountAccess(teamId: string, accountId: string): Promise<BindingAccess>
  atlasUpdateUpstashAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasGetTencentAccountAccess(teamId: string, accountId: string): Promise<BindingAccess>
  atlasUpdateTencentAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasGetAliyunAccountAccess(teamId: string, accountId: string): Promise<BindingAccess>
  atlasUpdateAliyunAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasGetVolcengineAccountAccess(teamId: string, accountId: string): Promise<BindingAccess>
  atlasUpdateVolcengineAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasGetHuaweiAccountAccess(teamId: string, accountId: string): Promise<BindingAccess>
  atlasUpdateHuaweiAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasGetBetterStackIntegrationAccess(
    teamId: string,
    integrationId: string,
  ): Promise<BindingAccess>
  atlasUpdateBetterStackIntegrationAccess(
    teamId: string,
    integrationId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasListResendIntegrations(teamId: string): Promise<ResendIntegration[]>
  atlasBindResendIntegration(
    teamId: string,
    label: string,
    apiKey: string,
  ): Promise<ResendIntegration>
  atlasUnbindResendIntegration(teamId: string, integrationId: string): Promise<void>
  atlasListVantaTests(
    teamId: string,
    integrationId: string,
    opts?: { status?: string; infraOnly?: boolean },
  ): Promise<VantaTest[]>
  atlasListTencentAccounts(teamId: string): Promise<TencentAccount[]>
  atlasGetTencentOidcInfo(teamId: string): Promise<TencentOidcInfo>
  atlasBindTencentAccount(
    teamId: string,
    label: string,
    site: TencentSite,
    roleArn: string,
    providerId: string,
  ): Promise<TencentAccount>
  atlasUnbindTencentAccount(teamId: string, accountId: string): Promise<void>
  atlasListTencentClusters(teamId: string, accountId: string): Promise<AtlasCluster[]>
  atlasListTencentCvmInstances(teamId: string, accountId: string): Promise<TencentCvmInstance[]>
  atlasListAzureAccounts(teamId: string): Promise<AzureAccount[]>
  atlasGetAzureOidcInfo(teamId: string): Promise<AzureOidcInfo>
  atlasGetGcpWifInfo(teamId: string): Promise<GcpWifInfo>
  atlasBindAzureAccount(
    teamId: string,
    label: string,
    tenantId: string,
    clientId: string,
    subscriptionId: string,
  ): Promise<AzureAccount>
  atlasUnbindAzureAccount(teamId: string, accountId: string): Promise<void>
  atlasListAzureClusters(teamId: string, accountId: string): Promise<AtlasCluster[]>
  atlasListAzureRoleAssignments(teamId: string, accountId: string): Promise<AzureRoleAssignment[]>
  atlasGetAzureAccountAccess(teamId: string, accountId: string): Promise<BindingAccess>
  atlasUpdateAzureAccountAccess(
    teamId: string,
    accountId: string,
    access: Pick<BindingAccess, 'memberAllowList'>,
  ): Promise<BindingAccess>
  atlasListAliyunAccounts(teamId: string): Promise<AliyunAccount[]>
  atlasGetAliyunOidcInfo(teamId: string): Promise<AliyunOidcInfo>
  atlasBindAliyunAccount(
    teamId: string,
    label: string,
    site: AliyunSite,
    roleArn: string,
    oidcProviderArn: string,
  ): Promise<AliyunAccount>
  atlasUnbindAliyunAccount(teamId: string, accountId: string): Promise<void>
  atlasListAliyunClusters(teamId: string, accountId: string): Promise<AtlasCluster[]>
  atlasListAliyunEcsInstances(teamId: string, accountId: string): Promise<AliyunEcsInstance[]>
  atlasListAliyunSwasInstances(teamId: string, accountId: string): Promise<AliyunSwasInstance[]>
  atlasListVolcengineAccounts(teamId: string): Promise<VolcengineAccount[]>
  atlasGetVolcengineOidcInfo(teamId: string): Promise<VolcengineOidcInfo>
  atlasBindVolcengineAccount(
    teamId: string,
    label: string,
    roleTrn: string,
  ): Promise<VolcengineAccount>
  atlasUnbindVolcengineAccount(teamId: string, accountId: string): Promise<void>
  atlasListHuaweiAccounts(teamId: string): Promise<HuaweiAccount[]>
  atlasGetHuaweiOidcInfo(teamId: string): Promise<HuaweiOidcInfo>
  atlasBindHuaweiAccount(
    teamId: string,
    label: string,
    domainId: string,
    idpId: string,
    agencyName: string,
  ): Promise<HuaweiAccount>
  atlasUnbindHuaweiAccount(teamId: string, accountId: string): Promise<void>
  atlasListVolcengineClusters(teamId: string, accountId: string): Promise<AtlasCluster[]>
  atlasListVolcengineEcsInstances(
    teamId: string,
    accountId: string,
  ): Promise<VolcengineEcsInstance[]>
  atlasListTailscaleClients(teamId: string): Promise<TailscaleOAuthClient[]>
  atlasBindTailscaleClient(
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string | null,
    federated?: boolean,
  ): Promise<TailscaleOAuthClient>
  atlasUnbindTailscaleClient(teamId: string, clientId: string): Promise<void>
  atlasListTailscaleDevices(teamId: string, clientId: string): Promise<TailscaleDevice[]>
  atlasSetTailscaleSandboxAccess(
    teamId: string,
    clientId: string,
    enabled: boolean,
    tag: string,
  ): Promise<TailscaleOAuthClient>
  atlasGenerateTailscaleAclSnippet(
    teamId: string,
    clientId: string,
    targetTag: string,
    sshUsers: string[],
    recorderTag?: string,
  ): Promise<string>
  atlasListZeaburProviders(teamId: string): Promise<ZeaburProvider[]>
  atlasBindZeaburProvider(teamId: string, token: string): Promise<ZeaburProvider[]>
  atlasUnbindZeaburProvider(teamId: string, zeaburId: string): Promise<void>
  atlasListZeaburProjects(teamId: string, zeaburId: string): Promise<ZeaburProject[]>
  atlasListZeaburServers(teamId: string, zeaburId: string): Promise<ZeaburServer[]>
  atlasListLinodeInstances(teamId: string, accountId: string): Promise<LinodeInstance[]>
  atlasListLkeClusters(teamId: string, accountId: string): Promise<LkeCluster[]>
  atlasUseLinodeCluster(
    teamId: string,
    accountId: string,
    clusterId: number,
    clusterLabel: string,
  ): Promise<{ context: string; label: string }>
  useClusterViaEndpoint(
    host: string,
    clusterLabel: string,
  ): Promise<{ context: string; label: string }>
}
