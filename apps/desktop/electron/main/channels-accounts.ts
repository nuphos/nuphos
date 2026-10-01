import * as atlas from '../atlas'
import * as k8s from '../k8s'

export const accountsChannels = {
  'atlas:getApiUrl': () => atlas.getApiUrl(),
  'atlas:listClusters': (_e: unknown, teamId: string) => atlas.listClusters(teamId),
  'atlas:useCluster': async (
    _e: unknown,
    teamId: string,
    provider: string,
    region: string,
    name: string,
  ) => {
    const r = await atlas.getKubeconfig(teamId, provider, region, name)
    const context = await k8s.loadKubeconfigYaml(
      r.yaml,
      `${teamId}/${provider}/${region}/${name}`,
      () => atlas.getKubeconfig(teamId, provider, region, name),
      r.expiresAt,
    )

    return { context, expiresAt: r.expiresAt }
  },
  'atlas:listAwsAccounts': (_e: unknown, teamId: string) => atlas.listAwsAccounts(teamId),
  'atlas:listGcpProjects': (_e: unknown, teamId: string) => atlas.listGcpProjects(teamId),
  'atlas:bindAwsAccount': (_e: unknown, teamId: string, roleArn: string) =>
    atlas.bindAwsAccount(teamId, roleArn),
  'atlas:unbindAwsAccount': (_e: unknown, teamId: string, accountId: string, roleId?: string) =>
    atlas.unbindAwsAccount(teamId, accountId, roleId),
  'atlas:getAwsAccountAccess': (_e: unknown, teamId: string, accountId: string, roleId?: string) =>
    atlas.getAwsAccountAccess(teamId, accountId, roleId),
  'atlas:updateAwsAccountAccess': (
    _e: unknown,
    teamId: string,
    accountId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
    roleId?: string,
  ) => atlas.updateAwsAccountAccess(teamId, accountId, access, roleId),
  'atlas:bindGcpProject': (
    _e: unknown,
    teamId: string,
    serviceAccountEmail: string,
    projectId: string,
  ) => atlas.bindGcpProject(teamId, serviceAccountEmail, projectId),
  'atlas:unbindGcpProject': (
    _e: unknown,
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => atlas.unbindGcpProject(teamId, projectId, serviceAccountId),
  'atlas:getGcpProjectAccess': (
    _e: unknown,
    teamId: string,
    projectId: string,
    serviceAccountId?: string,
  ) => atlas.getGcpProjectAccess(teamId, projectId, serviceAccountId),
  'atlas:updateGcpProjectAccess': (
    _e: unknown,
    teamId: string,
    projectId: string,
    access: Pick<atlas.BindingAccess, 'memberAllowList'>,
    serviceAccountId?: string,
  ) => atlas.updateGcpProjectAccess(teamId, projectId, access, serviceAccountId),
  'atlas:bindCloudflareAccount': (_e: unknown, teamId: string, accountId: string, apiKey: string) =>
    atlas.bindCloudflareAccount(teamId, accountId, apiKey),
  'atlas:unbindCloudflareAccount': (_e: unknown, teamId: string, accountId: string) =>
    atlas.unbindCloudflareAccount(teamId, accountId),
} as const
