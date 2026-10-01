import type {
  CloudflareD1Database,
  CloudflareD1DatabaseInput,
  CloudflareD1QueryResult,
  CloudflareKvKeyPage,
  CloudflareKvNamespace,
  CloudflareKvValue,
  CloudflarePagesDeploymentSummary,
  CloudflarePagesDomain,
  CloudflarePagesLogLine,
  CloudflarePagesProject,
} from '../types/cloudflare.ts'
import type { DatabaseConnection } from '../types/database.ts'

export type WindowCloudflarePagesApi = {
  atlasListCloudflarePagesProjects(
    teamId: string,
    accountId: string,
  ): Promise<CloudflarePagesProject[]>
  atlasGetCloudflarePagesProject(
    teamId: string,
    accountId: string,
    projectName: string,
  ): Promise<CloudflarePagesProject>
  atlasDeleteCloudflarePagesProject(
    teamId: string,
    accountId: string,
    projectName: string,
  ): Promise<void>
  atlasListCloudflarePagesDeployments(
    teamId: string,
    accountId: string,
    projectName: string,
  ): Promise<CloudflarePagesDeploymentSummary[]>
  atlasCreateCloudflarePagesDeployment(
    teamId: string,
    accountId: string,
    projectName: string,
    branch?: string,
  ): Promise<CloudflarePagesDeploymentSummary>
  atlasRetryCloudflarePagesDeployment(
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ): Promise<CloudflarePagesDeploymentSummary>
  atlasRollbackCloudflarePagesDeployment(
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ): Promise<CloudflarePagesDeploymentSummary>
  atlasGetCloudflarePagesDeploymentLogs(
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ): Promise<CloudflarePagesLogLine[]>
  atlasListCloudflarePagesDomains(
    teamId: string,
    accountId: string,
    projectName: string,
  ): Promise<CloudflarePagesDomain[]>
  atlasAddCloudflarePagesDomain(
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ): Promise<void>
  atlasDeleteCloudflarePagesDomain(
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ): Promise<void>
  atlasListCloudflareD1Databases(teamId: string, accountId: string): Promise<CloudflareD1Database[]>
  atlasCreateCloudflareD1Database(
    teamId: string,
    accountId: string,
    input: CloudflareD1DatabaseInput,
  ): Promise<CloudflareD1Database>
  atlasGetCloudflareD1Database(
    teamId: string,
    accountId: string,
    databaseId: string,
  ): Promise<CloudflareD1Database>
  atlasOpenCloudflareD1InDatabases(
    teamId: string,
    accountId: string,
    databaseId: string,
  ): Promise<DatabaseConnection>
  atlasDeleteCloudflareD1Database(
    teamId: string,
    accountId: string,
    databaseId: string,
  ): Promise<void>
  atlasListCloudflareD1Tables(
    teamId: string,
    accountId: string,
    databaseId: string,
  ): Promise<string[]>
  atlasQueryCloudflareD1(
    teamId: string,
    accountId: string,
    databaseId: string,
    sql: string,
    params?: string[],
  ): Promise<CloudflareD1QueryResult>
  atlasListCloudflareKvNamespaces(
    teamId: string,
    accountId: string,
  ): Promise<CloudflareKvNamespace[]>
  atlasCreateCloudflareKvNamespace(
    teamId: string,
    accountId: string,
    title: string,
  ): Promise<CloudflareKvNamespace>
  atlasRenameCloudflareKvNamespace(
    teamId: string,
    accountId: string,
    namespaceId: string,
    title: string,
  ): Promise<void>
  atlasDeleteCloudflareKvNamespace(
    teamId: string,
    accountId: string,
    namespaceId: string,
  ): Promise<void>
  atlasListCloudflareKvKeys(
    teamId: string,
    accountId: string,
    namespaceId: string,
    prefix?: string,
    cursor?: string | null,
  ): Promise<CloudflareKvKeyPage>
  atlasReadCloudflareKvValue(
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ): Promise<CloudflareKvValue>
  atlasWriteCloudflareKvValue(
    teamId: string,
    accountId: string,
    namespaceId: string,
    input: { key: string; value: string; expirationTtl?: number },
  ): Promise<void>
  atlasDeleteCloudflareKvValue(
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ): Promise<void>
}
