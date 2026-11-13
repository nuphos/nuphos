import * as atlas from '../atlas'

import { bindingAccessChannels } from './channels-binding-access'
import { plaudChannels } from './channels-plaud'
import { vpsChannels } from './channels-vps'

export const integrationsChannels = {
  ...plaudChannels,
  ...bindingAccessChannels,
  ...vpsChannels,
  'atlas:listVantaIntegrations': (_e: unknown, teamId: string) =>
    atlas.listVantaIntegrations(teamId),
  'atlas:bindVantaIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string,
    share?: atlas.BindingShare,
  ) => atlas.bindVantaIntegration(teamId, label, clientId, clientSecret, share),
  'atlas:unbindVantaIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindVantaIntegration(teamId, integrationId),
  'atlas:listSecureframeIntegrations': (_e: unknown, teamId: string) =>
    atlas.listSecureframeIntegrations(teamId),
  'atlas:bindSecureframeIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    region: 'us' | 'uk',
    apiKey: string,
    apiSecret: string,
    share?: atlas.BindingShare,
  ) => atlas.bindSecureframeIntegration(teamId, label, region, apiKey, apiSecret, share),
  'atlas:unbindSecureframeIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindSecureframeIntegration(teamId, integrationId),
  'atlas:listSonarqubeIntegrations': (_e: unknown, teamId: string) =>
    atlas.listSonarqubeIntegrations(teamId),
  'atlas:listSonarqubeProjects': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    page?: number,
    pageSize?: number,
  ) => atlas.listSonarqubeProjects(teamId, integrationId, page, pageSize),
  'atlas:bindSonarqubeIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    baseUrl: string,
    token: string,
  ) => atlas.bindSonarqubeIntegration(teamId, label, baseUrl, token),
  'atlas:unbindSonarqubeIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindSonarqubeIntegration(teamId, integrationId),
  'atlas:listSecureframeTests': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    failingOnly?: boolean,
  ) => atlas.listSecureframeTests(teamId, integrationId, failingOnly),
  'atlas:listNotionIntegrations': (_e: unknown, teamId: string) =>
    atlas.listNotionIntegrations(teamId),
  'atlas:bindNotionIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    token: string,
    share?: atlas.BindingShare,
  ) => atlas.bindNotionIntegration(teamId, label, token, share),
  'atlas:unbindNotionIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindNotionIntegration(teamId, integrationId),
  'atlas:listUpstashAccounts': (_e: unknown, teamId: string) => atlas.listUpstashAccounts(teamId),
  'atlas:bindUpstashAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    email: string,
    apiKey: string,
    share?: atlas.BindingShare,
  ) => atlas.bindUpstashAccount(teamId, label, email, apiKey, share),
  'atlas:unbindUpstashAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindUpstashAccount(teamId, accountId),
  'atlas:getUpstashAccountAccess': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getUpstashAccountAccess(teamId, accountId),
  'atlas:updateUpstashAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateUpstashAccountAccess(teamId, accountId, access),
  'atlas:getTencentAccountAccess': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getTencentAccountAccess(teamId, accountId),
  'atlas:updateTencentAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateTencentAccountAccess(teamId, accountId, access),
  'atlas:getAliyunAccountAccess': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getAliyunAccountAccess(teamId, accountId),
  'atlas:updateAliyunAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateAliyunAccountAccess(teamId, accountId, access),
  'atlas:getVolcengineAccountAccess': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getVolcengineAccountAccess(teamId, accountId),
  'atlas:updateVolcengineAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateVolcengineAccountAccess(teamId, accountId, access),
  'atlas:getHuaweiAccountAccess': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getHuaweiAccountAccess(teamId, accountId),
  'atlas:updateHuaweiAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Parameters<typeof atlas.updateHuaweiAccountAccess>[2],
  ) => atlas.updateHuaweiAccountAccess(teamId, accountId, access),
  'atlas:getBetterStackIntegrationAccess': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.getBetterStackIntegrationAccess(teamId, integrationId),
  'atlas:updateBetterStackIntegrationAccess': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateBetterStackIntegrationAccess(teamId, integrationId, access),
  'atlas:getTrelloAccess': (_e: unknown, teamId: string, id: string) =>
    atlas.getTrelloAccess(teamId, id),
  'atlas:updateTrelloAccess': (
    _e: unknown,
    teamId: string,
    id: string,
    input: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateTrelloAccess(teamId, id, input),
  'atlas:listResendIntegrations': (_e: unknown, teamId: string) =>
    atlas.listResendIntegrations(teamId),
  'atlas:listTrelloIntegrations': (_e: unknown, teamId: string) =>
    atlas.listTrelloIntegrations(teamId),
  'atlas:bindResendIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    apiKey: string,
    share?: atlas.BindingShare,
  ) => atlas.bindResendIntegration(teamId, label, apiKey, share),
  'atlas:unbindResendIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindResendIntegration(teamId, integrationId),
  'atlas:unbindTrelloIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindTrelloIntegration(teamId, integrationId),
  'atlas:listVantaTests': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    opts?: { status?: string; infraOnly?: boolean },
  ) => atlas.listVantaTests(teamId, integrationId, opts),
  'atlas:listTencentAccounts': (_e: unknown, teamId: string) => atlas.listTencentAccounts(teamId),
  'atlas:getTencentOidcInfo': (_e: unknown, teamId: string) => atlas.getTencentOidcInfo(teamId),
  'atlas:bindTencentAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    site: atlas.TencentSite,
    roleArn: string,
    providerId: string,
    share?: atlas.BindingShare,
  ) => atlas.bindTencentAccount(teamId, label, site, roleArn, providerId, share),
  'atlas:unbindTencentAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindTencentAccount(teamId, accountId),
  'atlas:listTencentClusters': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listTencentClusters(teamId, accountId),
  'atlas:listAzureAccounts': (_e: unknown, teamId: string) => atlas.listAzureAccounts(teamId),
  'atlas:getAzureOidcInfo': (_e: unknown, teamId: string) => atlas.getAzureOidcInfo(teamId),
  'atlas:getGcpWifInfo': (_e: unknown, teamId: string) => atlas.getGcpWifInfo(teamId),
  'atlas:bindAzureAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    tenantId: string,
    clientId: string,
    subscriptionId: string,
  ) => atlas.bindAzureAccount(teamId, label, tenantId, clientId, subscriptionId),
  'atlas:unbindAzureAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindAzureAccount(teamId, accountId),
  'atlas:listAzureClusters': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listAzureClusters(teamId, accountId),
  'atlas:listAzureRoleAssignments': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listAzureRoleAssignments(teamId, accountId),
  'atlas:getAzureAccountAccess': (_e: unknown, teamId: string, accountId: string) =>
    atlas.getAzureAccountAccess(teamId, accountId),
  'atlas:updateAzureAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
  ) => atlas.updateAzureAccountAccess(teamId, accountId, access),
  'atlas:listTencentCvmInstances': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listTencentCvmInstances(teamId, accountId),
  'atlas:listAliyunAccounts': (_e: unknown, teamId: string) => atlas.listAliyunAccounts(teamId),
  'atlas:getAliyunOidcInfo': (_e: unknown, teamId: string) => atlas.getAliyunOidcInfo(teamId),
  'atlas:bindAliyunAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    site: atlas.AliyunSite,
    roleArn: string,
    oidcProviderArn: string,
    share?: atlas.BindingShare,
  ) => atlas.bindAliyunAccount(teamId, label, site, roleArn, oidcProviderArn, share),
  'atlas:unbindAliyunAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindAliyunAccount(teamId, accountId),
  'atlas:listAliyunClusters': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listAliyunClusters(teamId, accountId),
  'atlas:listAliyunEcsInstances': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listAliyunEcsInstances(teamId, accountId),
  'atlas:listAliyunSwasInstances': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listAliyunSwasInstances(teamId, accountId),
  'atlas:listVolcengineAccounts': (_e: unknown, teamId: string) =>
    atlas.listVolcengineAccounts(teamId),
  'atlas:getVolcengineOidcInfo': (_e: unknown, teamId: string) =>
    atlas.getVolcengineOidcInfo(teamId),
  'atlas:bindVolcengineAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    roleTrn: string,
    share?: atlas.BindingShare,
  ) => atlas.bindVolcengineAccount(teamId, label, roleTrn, share),
  'atlas:unbindVolcengineAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindVolcengineAccount(teamId, accountId),
  'atlas:listHuaweiAccounts': (_e: unknown, teamId: string) => atlas.listHuaweiAccounts(teamId),
  'atlas:getHuaweiOidcInfo': (_e: unknown, teamId: string) => atlas.getHuaweiOidcInfo(teamId),
  'atlas:bindHuaweiAccount': (
    _e: unknown,
    teamId: string,
    label: string,
    domainId: string,
    idpId: string,
    agencyName: string,
    share?: atlas.BindingShare,
  ) => atlas.bindHuaweiAccount(teamId, label, domainId, idpId, agencyName, share),
  'atlas:unbindHuaweiAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindHuaweiAccount(teamId, accountId),
  'atlas:listVolcengineClusters': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listVolcengineClusters(teamId, accountId),
  'atlas:listVolcengineEcsInstances': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listVolcengineEcsInstances(teamId, accountId),
  'atlas:listTailscaleClients': (_e: unknown, teamId: string) => atlas.listTailscaleClients(teamId),
  'atlas:bindTailscaleClient': (
    _e: unknown,
    teamId: string,
    label: string,
    clientId: string,
    clientSecret: string | null,
    federated?: boolean,
    share?: atlas.BindingShare,
  ) => atlas.bindTailscaleClient(teamId, label, clientId, clientSecret, federated, share),
  'atlas:unbindTailscaleClient': (_e: unknown, teamId: string, clientId: string) =>
    atlas.unbindTailscaleClient(teamId, clientId),
  'atlas:listTailscaleDevices': (_e: unknown, teamId: string, clientId: string) =>
    atlas.listTailscaleDevices(teamId, clientId),
  'atlas:setTailscaleSandboxAccess': (
    _e: unknown,
    teamId: string,
    clientId: string,
    enabled: boolean,
    tag: string,
  ) => atlas.setTailscaleSandboxAccess(teamId, clientId, enabled, tag),
  'atlas:generateTailscaleAclSnippet': (
    _e: unknown,
    teamId: string,
    clientId: string,
    targetTag: string,
    sshUsers: string[],
    recorderTag?: string,
  ) => atlas.generateTailscaleAclSnippet(teamId, clientId, targetTag, sshUsers, recorderTag),
  'atlas:listZeaburProviders': (_e: unknown, teamId: string) => atlas.listZeaburProviders(teamId),
  'atlas:bindZeaburProvider': (_e: unknown, teamId: string, token: string) =>
    atlas.bindZeaburProvider(teamId, token),
  'atlas:unbindZeaburProvider': (_e: unknown, teamId: string, zeaburId: string) =>
    atlas.unbindZeaburProvider(teamId, zeaburId),
  'atlas:listZeaburProjects': (_e: unknown, teamId: string, zeaburId: string) =>
    atlas.listZeaburProjects(teamId, zeaburId),
  'atlas:listZeaburServers': (_e: unknown, teamId: string, zeaburId: string) =>
    atlas.listZeaburServers(teamId, zeaburId),
  'atlas:listLinodeInstances': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listLinodeInstances(teamId, accountId),
  'atlas:listLkeClusters': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listLkeClusters(teamId, accountId),
} as const
