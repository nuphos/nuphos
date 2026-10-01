import * as atlas from '../atlas'

export const cloudflareAppsChannels = {
  // --- Cloudflare Pages ---
  'atlas:listCloudflarePagesProjects': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflarePagesProjects(teamId, accountId),
  'atlas:getCloudflarePagesProject': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
  ) => atlas.getCloudflarePagesProject(teamId, accountId, projectName),
  'atlas:deleteCloudflarePagesProject': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
  ) => atlas.deleteCloudflarePagesProject(teamId, accountId, projectName),
  'atlas:listCloudflarePagesDeployments': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
  ) => atlas.listCloudflarePagesDeployments(teamId, accountId, projectName),
  'atlas:createCloudflarePagesDeployment': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
    branch?: string,
  ) => atlas.createCloudflarePagesDeployment(teamId, accountId, projectName, branch),
  'atlas:retryCloudflarePagesDeployment': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) => atlas.retryCloudflarePagesDeployment(teamId, accountId, projectName, deploymentId),
  'atlas:rollbackCloudflarePagesDeployment': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) => atlas.rollbackCloudflarePagesDeployment(teamId, accountId, projectName, deploymentId),
  'atlas:getCloudflarePagesDeploymentLogs': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) => atlas.getCloudflarePagesDeploymentLogs(teamId, accountId, projectName, deploymentId),
  'atlas:listCloudflarePagesDomains': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
  ) => atlas.listCloudflarePagesDomains(teamId, accountId, projectName),
  'atlas:addCloudflarePagesDomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ) => atlas.addCloudflarePagesDomain(teamId, accountId, projectName, name),
  'atlas:deleteCloudflarePagesDomain': (
    _e: unknown,
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ) => atlas.deleteCloudflarePagesDomain(teamId, accountId, projectName, name),
  // --- Cloudflare D1 ---
  'atlas:listCloudflareD1Databases': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflareD1Databases(teamId, accountId),
  'atlas:createCloudflareD1Database': (
    _e: unknown,
    teamId: string,
    accountId: string,
    input: atlas.CloudflareD1DatabaseInput,
  ) => atlas.createCloudflareD1Database(teamId, accountId, input),
  'atlas:getCloudflareD1Database': (
    _e: unknown,
    teamId: string,
    accountId: string,
    databaseId: string,
  ) => atlas.getCloudflareD1Database(teamId, accountId, databaseId),
  'atlas:openCloudflareD1InDatabases': (
    _e: unknown,
    teamId: string,
    accountId: string,
    databaseId: string,
  ) => atlas.openCloudflareD1InDatabases(teamId, accountId, databaseId),
  'atlas:deleteCloudflareD1Database': (
    _e: unknown,
    teamId: string,
    accountId: string,
    databaseId: string,
  ) => atlas.deleteCloudflareD1Database(teamId, accountId, databaseId),
  'atlas:listCloudflareD1Tables': (
    _e: unknown,
    teamId: string,
    accountId: string,
    databaseId: string,
  ) => atlas.listCloudflareD1Tables(teamId, accountId, databaseId),
  'atlas:queryCloudflareD1': (
    _e: unknown,
    teamId: string,
    accountId: string,
    databaseId: string,
    sql: string,
    params?: string[],
  ) => atlas.queryCloudflareD1(teamId, accountId, databaseId, sql, params),
  // --- Cloudflare KV ---
  'atlas:listCloudflareKvNamespaces': (_e: unknown, teamId: string, accountId: string) =>
    atlas.listCloudflareKvNamespaces(teamId, accountId),
  'atlas:createCloudflareKvNamespace': (
    _e: unknown,
    teamId: string,
    accountId: string,
    title: string,
  ) => atlas.createCloudflareKvNamespace(teamId, accountId, title),
  'atlas:renameCloudflareKvNamespace': (
    _e: unknown,
    teamId: string,
    accountId: string,
    namespaceId: string,
    title: string,
  ) => atlas.renameCloudflareKvNamespace(teamId, accountId, namespaceId, title),
  'atlas:deleteCloudflareKvNamespace': (
    _e: unknown,
    teamId: string,
    accountId: string,
    namespaceId: string,
  ) => atlas.deleteCloudflareKvNamespace(teamId, accountId, namespaceId),
  'atlas:listCloudflareKvKeys': (
    _e: unknown,
    teamId: string,
    accountId: string,
    namespaceId: string,
    prefix?: string,
    cursor?: string | null,
  ) => atlas.listCloudflareKvKeys(teamId, accountId, namespaceId, prefix, cursor),
  'atlas:readCloudflareKvValue': (
    _e: unknown,
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ) => atlas.readCloudflareKvValue(teamId, accountId, namespaceId, key),
  'atlas:writeCloudflareKvValue': (
    _e: unknown,
    teamId: string,
    accountId: string,
    namespaceId: string,
    input: { key: string; value: string; expirationTtl?: number },
  ) => atlas.writeCloudflareKvValue(teamId, accountId, namespaceId, input),
  'atlas:deleteCloudflareKvValue': (
    _e: unknown,
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ) => atlas.deleteCloudflareKvValue(teamId, accountId, namespaceId, key),
} as const
