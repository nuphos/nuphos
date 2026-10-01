import { ipcRenderer } from 'electron'

export const cloudflareApi = {
  atlasUpdateCloudflareWorkerCronTriggers: (
    teamId: string,
    accountId: string,
    scriptName: string,
    crons: string[],
  ) =>
    ipcRenderer.invoke(
      'atlas:updateCloudflareWorkerCronTriggers',
      teamId,
      accountId,
      scriptName,
      crons,
    ),
  atlasListCloudflareWorkerDeployments: (teamId: string, accountId: string, scriptName: string) =>
    ipcRenderer.invoke('atlas:listCloudflareWorkerDeployments', teamId, accountId, scriptName),
  atlasGetCloudflareWorkerSubdomain: (teamId: string, accountId: string, scriptName: string) =>
    ipcRenderer.invoke('atlas:getCloudflareWorkerSubdomain', teamId, accountId, scriptName),
  atlasDeleteCloudflareWorker: (teamId: string, accountId: string, scriptName: string) =>
    ipcRenderer.invoke('atlas:deleteCloudflareWorker', teamId, accountId, scriptName),
  // --- Cloudflare R2 ---
  atlasGetCloudflareR2Credentials: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:getCloudflareR2Credentials', teamId, accountId),
  atlasBindCloudflareR2Credentials: (teamId: string, accountId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:bindCloudflareR2Credentials', teamId, accountId, input),
  atlasUnbindCloudflareR2Credentials: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindCloudflareR2Credentials', teamId, accountId),
  atlasListCloudflareR2Buckets: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareR2Buckets', teamId, accountId),
  atlasCreateCloudflareR2Bucket: (teamId: string, accountId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:createCloudflareR2Bucket', teamId, accountId, input),
  atlasDeleteCloudflareR2Bucket: (teamId: string, accountId: string, bucketName: string) =>
    ipcRenderer.invoke('atlas:deleteCloudflareR2Bucket', teamId, accountId, bucketName),
  atlasGetCloudflareR2BucketUsage: (teamId: string, accountId: string, bucketName: string) =>
    ipcRenderer.invoke('atlas:getCloudflareR2BucketUsage', teamId, accountId, bucketName),
  atlasGetCloudflareR2ManagedDomain: (teamId: string, accountId: string, bucketName: string) =>
    ipcRenderer.invoke('atlas:getCloudflareR2ManagedDomain', teamId, accountId, bucketName),
  atlasSetCloudflareR2ManagedDomain: (
    teamId: string,
    accountId: string,
    bucketName: string,
    enabled: boolean,
  ) =>
    ipcRenderer.invoke(
      'atlas:setCloudflareR2ManagedDomain',
      teamId,
      accountId,
      bucketName,
      enabled,
    ),
  atlasListCloudflareR2CustomDomains: (teamId: string, accountId: string, bucketName: string) =>
    ipcRenderer.invoke('atlas:listCloudflareR2CustomDomains', teamId, accountId, bucketName),
  atlasAddCloudflareR2CustomDomain: (
    teamId: string,
    accountId: string,
    bucketName: string,
    input: unknown,
  ) =>
    ipcRenderer.invoke('atlas:addCloudflareR2CustomDomain', teamId, accountId, bucketName, input),
  atlasDeleteCloudflareR2CustomDomain: (
    teamId: string,
    accountId: string,
    bucketName: string,
    domain: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:deleteCloudflareR2CustomDomain',
      teamId,
      accountId,
      bucketName,
      domain,
    ),
  atlasListCloudflareR2Objects: (
    teamId: string,
    accountId: string,
    bucketName: string,
    prefix: string,
    cursor: string | null,
  ) =>
    ipcRenderer.invoke(
      'atlas:listCloudflareR2Objects',
      teamId,
      accountId,
      bucketName,
      prefix,
      cursor,
    ),
  atlasGetCloudflareR2ObjectDownloadUrl: (
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getCloudflareR2ObjectDownloadUrl',
      teamId,
      accountId,
      bucketName,
      key,
    ),
  atlasGetCloudflareR2ObjectPreview: (
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => ipcRenderer.invoke('atlas:getCloudflareR2ObjectPreview', teamId, accountId, bucketName, key),
  atlasPutCloudflareR2Object: (
    teamId: string,
    accountId: string,
    bucketName: string,
    input: unknown,
  ) => ipcRenderer.invoke('atlas:putCloudflareR2Object', teamId, accountId, bucketName, input),
  atlasDeleteCloudflareR2Object: (
    teamId: string,
    accountId: string,
    bucketName: string,
    key: string,
  ) => ipcRenderer.invoke('atlas:deleteCloudflareR2Object', teamId, accountId, bucketName, key),
  // --- Cloudflare Pages ---
  atlasListCloudflarePagesProjects: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflarePagesProjects', teamId, accountId),
  atlasGetCloudflarePagesProject: (teamId: string, accountId: string, projectName: string) =>
    ipcRenderer.invoke('atlas:getCloudflarePagesProject', teamId, accountId, projectName),
  atlasDeleteCloudflarePagesProject: (teamId: string, accountId: string, projectName: string) =>
    ipcRenderer.invoke('atlas:deleteCloudflarePagesProject', teamId, accountId, projectName),
  atlasListCloudflarePagesDeployments: (teamId: string, accountId: string, projectName: string) =>
    ipcRenderer.invoke('atlas:listCloudflarePagesDeployments', teamId, accountId, projectName),
  atlasCreateCloudflarePagesDeployment: (
    teamId: string,
    accountId: string,
    projectName: string,
    branch?: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:createCloudflarePagesDeployment',
      teamId,
      accountId,
      projectName,
      branch,
    ),
  atlasRetryCloudflarePagesDeployment: (
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:retryCloudflarePagesDeployment',
      teamId,
      accountId,
      projectName,
      deploymentId,
    ),
  atlasRollbackCloudflarePagesDeployment: (
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:rollbackCloudflarePagesDeployment',
      teamId,
      accountId,
      projectName,
      deploymentId,
    ),
  atlasGetCloudflarePagesDeploymentLogs: (
    teamId: string,
    accountId: string,
    projectName: string,
    deploymentId: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:getCloudflarePagesDeploymentLogs',
      teamId,
      accountId,
      projectName,
      deploymentId,
    ),
  atlasListCloudflarePagesDomains: (teamId: string, accountId: string, projectName: string) =>
    ipcRenderer.invoke('atlas:listCloudflarePagesDomains', teamId, accountId, projectName),
  atlasAddCloudflarePagesDomain: (
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ) => ipcRenderer.invoke('atlas:addCloudflarePagesDomain', teamId, accountId, projectName, name),
  atlasDeleteCloudflarePagesDomain: (
    teamId: string,
    accountId: string,
    projectName: string,
    name: string,
  ) =>
    ipcRenderer.invoke('atlas:deleteCloudflarePagesDomain', teamId, accountId, projectName, name),
  // --- Cloudflare D1 ---
  atlasListCloudflareD1Databases: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareD1Databases', teamId, accountId),
  atlasCreateCloudflareD1Database: (teamId: string, accountId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:createCloudflareD1Database', teamId, accountId, input),
  atlasGetCloudflareD1Database: (teamId: string, accountId: string, databaseId: string) =>
    ipcRenderer.invoke('atlas:getCloudflareD1Database', teamId, accountId, databaseId),
  atlasOpenCloudflareD1InDatabases: (teamId: string, accountId: string, databaseId: string) =>
    ipcRenderer.invoke('atlas:openCloudflareD1InDatabases', teamId, accountId, databaseId),
  atlasDeleteCloudflareD1Database: (teamId: string, accountId: string, databaseId: string) =>
    ipcRenderer.invoke('atlas:deleteCloudflareD1Database', teamId, accountId, databaseId),
  atlasListCloudflareD1Tables: (teamId: string, accountId: string, databaseId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareD1Tables', teamId, accountId, databaseId),
  atlasQueryCloudflareD1: (
    teamId: string,
    accountId: string,
    databaseId: string,
    sql: string,
    params?: string[],
  ) => ipcRenderer.invoke('atlas:queryCloudflareD1', teamId, accountId, databaseId, sql, params),
  // --- Cloudflare KV ---
  atlasListCloudflareKvNamespaces: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:listCloudflareKvNamespaces', teamId, accountId),
  atlasCreateCloudflareKvNamespace: (teamId: string, accountId: string, title: string) =>
    ipcRenderer.invoke('atlas:createCloudflareKvNamespace', teamId, accountId, title),
  atlasRenameCloudflareKvNamespace: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    title: string,
  ) =>
    ipcRenderer.invoke('atlas:renameCloudflareKvNamespace', teamId, accountId, namespaceId, title),
  atlasDeleteCloudflareKvNamespace: (teamId: string, accountId: string, namespaceId: string) =>
    ipcRenderer.invoke('atlas:deleteCloudflareKvNamespace', teamId, accountId, namespaceId),
  atlasListCloudflareKvKeys: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    prefix?: string,
    cursor?: string | null,
  ) =>
    ipcRenderer.invoke(
      'atlas:listCloudflareKvKeys',
      teamId,
      accountId,
      namespaceId,
      prefix,
      cursor,
    ),
  atlasReadCloudflareKvValue: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ) => ipcRenderer.invoke('atlas:readCloudflareKvValue', teamId, accountId, namespaceId, key),
}
