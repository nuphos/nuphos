import type { CloudflareD1DatabaseInput } from '../types/cloudflare.ts'

export const cloudflarePagesApi = {
  atlasListCloudflarePagesProjects: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflarePagesProjects(teamId, accountId),
  atlasGetCloudflarePagesProject: (teamId: string, accountId: string, projectName: string) =>
    window.api.atlasGetCloudflarePagesProject(teamId, accountId, projectName),
  atlasDeleteCloudflarePagesProject: (teamId: string, accountId: string, projectName: string) =>
    window.api.atlasDeleteCloudflarePagesProject(teamId, accountId, projectName),
  atlasListCloudflarePagesDeployments: (teamId: string, accountId: string, projectName: string) =>
    window.api.atlasListCloudflarePagesDeployments(teamId, accountId, projectName),
  atlasCreateCloudflarePagesDeployment: (
    teamId: string,
    accountId: string,
    projectName: string,
    branch?: string,
  ) => window.api.atlasCreateCloudflarePagesDeployment(teamId, accountId, projectName, branch),
  atlasRetryCloudflarePagesDeployment: (
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) => window.api.atlasRetryCloudflarePagesDeployment(teamId, accountId, projectName, deploymentId),
  atlasRollbackCloudflarePagesDeployment: (
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) =>
    window.api.atlasRollbackCloudflarePagesDeployment(teamId, accountId, projectName, deploymentId),
  atlasGetCloudflarePagesDeploymentLogs: (
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) =>
    window.api.atlasGetCloudflarePagesDeploymentLogs(teamId, accountId, projectName, deploymentId),
  atlasListCloudflarePagesDomains: (teamId: string, accountId: string, projectName: string) =>
    window.api.atlasListCloudflarePagesDomains(teamId, accountId, projectName),
  atlasAddCloudflarePagesDomain: (
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ) => window.api.atlasAddCloudflarePagesDomain(teamId, accountId, projectName, name),
  atlasDeleteCloudflarePagesDomain: (
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ) => window.api.atlasDeleteCloudflarePagesDomain(teamId, accountId, projectName, name),
  // --- Cloudflare D1 ---
  atlasListCloudflareD1Databases: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflareD1Databases(teamId, accountId),
  atlasCreateCloudflareD1Database: (
    teamId: string,
    accountId: string,
    input: CloudflareD1DatabaseInput,
  ) => window.api.atlasCreateCloudflareD1Database(teamId, accountId, input),
  atlasGetCloudflareD1Database: (teamId: string, accountId: string, databaseId: string) =>
    window.api.atlasGetCloudflareD1Database(teamId, accountId, databaseId),
  atlasOpenCloudflareD1InDatabases: (teamId: string, accountId: string, databaseId: string) =>
    window.api.atlasOpenCloudflareD1InDatabases(teamId, accountId, databaseId),
  atlasDeleteCloudflareD1Database: (teamId: string, accountId: string, databaseId: string) =>
    window.api.atlasDeleteCloudflareD1Database(teamId, accountId, databaseId),
  atlasListCloudflareD1Tables: (teamId: string, accountId: string, databaseId: string) =>
    window.api.atlasListCloudflareD1Tables(teamId, accountId, databaseId),
  atlasQueryCloudflareD1: (
    teamId: string,
    accountId: string,
    databaseId: string,
    sql: string,
    params?: string[],
  ) => window.api.atlasQueryCloudflareD1(teamId, accountId, databaseId, sql, params),
  // --- Cloudflare KV ---
  atlasListCloudflareKvNamespaces: (teamId: string, accountId: string) =>
    window.api.atlasListCloudflareKvNamespaces(teamId, accountId),
  atlasCreateCloudflareKvNamespace: (teamId: string, accountId: string, title: string) =>
    window.api.atlasCreateCloudflareKvNamespace(teamId, accountId, title),
  atlasRenameCloudflareKvNamespace: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    title: string,
  ) => window.api.atlasRenameCloudflareKvNamespace(teamId, accountId, namespaceId, title),
  atlasDeleteCloudflareKvNamespace: (teamId: string, accountId: string, namespaceId: string) =>
    window.api.atlasDeleteCloudflareKvNamespace(teamId, accountId, namespaceId),
  atlasListCloudflareKvKeys: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    prefix?: string,
    cursor?: string | null,
  ) => window.api.atlasListCloudflareKvKeys(teamId, accountId, namespaceId, prefix, cursor),
  atlasReadCloudflareKvValue: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ) => window.api.atlasReadCloudflareKvValue(teamId, accountId, namespaceId, key),
  atlasWriteCloudflareKvValue: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    input: { key: string; value: string; expirationTtl?: number },
  ) => window.api.atlasWriteCloudflareKvValue(teamId, accountId, namespaceId, input),
  atlasDeleteCloudflareKvValue: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ) => window.api.atlasDeleteCloudflareKvValue(teamId, accountId, namespaceId, key),
}
