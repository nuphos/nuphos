import { ipcRenderer } from 'electron'

export const cloudAccountsApi = {
  atlasWriteCloudflareKvValue: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    input: unknown,
  ) => ipcRenderer.invoke('atlas:writeCloudflareKvValue', teamId, accountId, namespaceId, input),
  atlasDeleteCloudflareKvValue: (
    teamId: string,
    accountId: string,
    namespaceId: string,
    key: string,
  ) => ipcRenderer.invoke('atlas:deleteCloudflareKvValue', teamId, accountId, namespaceId, key),
  atlasBindAwsAccount: (teamId: string, roleArn: string) =>
    ipcRenderer.invoke('atlas:bindAwsAccount', teamId, roleArn),
  atlasUnbindAwsAccount: (teamId: string, accountId: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:unbindAwsAccount', teamId, accountId, roleId),
  atlasGetAwsAccountAccess: (teamId: string, accountId: string, roleId?: string) =>
    ipcRenderer.invoke('atlas:getAwsAccountAccess', teamId, accountId, roleId),
  atlasUpdateAwsAccountAccess: (
    teamId: string,
    accountId: string,
    access: unknown,
    roleId?: string,
  ) => ipcRenderer.invoke('atlas:updateAwsAccountAccess', teamId, accountId, access, roleId),
  atlasBindGcpProject: (teamId: string, serviceAccountEmail: string, projectId: string) =>
    ipcRenderer.invoke('atlas:bindGcpProject', teamId, serviceAccountEmail, projectId),
  atlasUnbindGcpProject: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:unbindGcpProject', teamId, projectId, serviceAccountId),
  atlasGetGcpProjectAccess: (teamId: string, projectId: string, serviceAccountId?: string) =>
    ipcRenderer.invoke('atlas:getGcpProjectAccess', teamId, projectId, serviceAccountId),
  atlasUpdateGcpProjectAccess: (
    teamId: string,
    projectId: string,
    access: unknown,
    serviceAccountId?: string,
  ) =>
    ipcRenderer.invoke('atlas:updateGcpProjectAccess', teamId, projectId, access, serviceAccountId),
  atlasBindCloudflareAccount: (teamId: string, accountId: string, apiKey: string) =>
    ipcRenderer.invoke('atlas:bindCloudflareAccount', teamId, accountId, apiKey),
  atlasUnbindCloudflareAccount: (teamId: string, accountId: string) =>
    ipcRenderer.invoke('atlas:unbindCloudflareAccount', teamId, accountId),
  atlasListBetterStackIntegrations: (teamId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackIntegrations', teamId),
  atlasBindBetterStackIntegration: (
    teamId: string,
    label: string,
    uptimeApiToken: string | null,
    telemetryApiToken: string | null,
  ) =>
    ipcRenderer.invoke(
      'atlas:bindBetterStackIntegration',
      teamId,
      label,
      uptimeApiToken,
      telemetryApiToken,
    ),
  atlasUpdateBetterStackIntegration: (
    teamId: string,
    integrationId: string,
    patch: {
      label?: string
      uptimeApiToken?: string | null
      telemetryApiToken?: string | null
    },
  ) => ipcRenderer.invoke('atlas:updateBetterStackIntegration', teamId, integrationId, patch),
  atlasUnbindBetterStackIntegration: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:unbindBetterStackIntegration', teamId, integrationId),
  atlasListBetterStackMonitors: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackMonitors', teamId, integrationId),
  atlasListBetterStackHeartbeats: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackHeartbeats', teamId, integrationId),
  atlasListBetterStackIncidents: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackIncidents', teamId, integrationId),
  atlasListBetterStackDashboards: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackDashboards', teamId, integrationId),
  atlasListBetterStackSources: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackSources', teamId, integrationId),
  atlasListBetterStackCollectors: (teamId: string, integrationId: string) =>
    ipcRenderer.invoke('atlas:listBetterStackCollectors', teamId, integrationId),
  atlasListUptimeKumaInstances: (teamId: string) =>
    ipcRenderer.invoke('atlas:listUptimeKumaInstances', teamId),
  atlasListDatabaseConnections: (teamId: string) =>
    ipcRenderer.invoke('atlas:listDatabaseConnections', teamId),
  atlasGetDatabaseConnection: (teamId: string, connectionId: string) =>
    ipcRenderer.invoke('atlas:getDatabaseConnection', teamId, connectionId),
  atlasGetMongoDatabaseCatalog: (teamId: string, connectionId: string, refresh?: boolean) =>
    ipcRenderer.invoke('atlas:getMongoDatabaseCatalog', teamId, connectionId, refresh),
  atlasGetMongoCollectionCatalog: (
    teamId: string,
    connectionId: string,
    database: string,
    refresh?: boolean,
  ) =>
    ipcRenderer.invoke('atlas:getMongoCollectionCatalog', teamId, connectionId, database, refresh),
  atlasGetMongoCollectionDetail: (
    teamId: string,
    connectionId: string,
    database: string,
    collection: string,
    refresh?: boolean,
  ) =>
    ipcRenderer.invoke(
      'atlas:getMongoCollectionDetail',
      teamId,
      connectionId,
      database,
      collection,
      refresh,
    ),
  atlasQueryMongoDatabase: (teamId: string, connectionId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:queryMongoDatabase', teamId, connectionId, input),
  atlasGetMongoMonitoringHistory: (teamId: string, connectionId: string, rangeMinutes?: number) =>
    ipcRenderer.invoke('atlas:getMongoMonitoringHistory', teamId, connectionId, rangeMinutes),
  atlasSampleMongoMonitoring: (teamId: string, connectionId: string) =>
    ipcRenderer.invoke('atlas:sampleMongoMonitoring', teamId, connectionId),
  atlasListDatabaseQueryAudit: (teamId: string, connectionId: string, limit?: number) =>
    ipcRenderer.invoke('atlas:listDatabaseQueryAudit', teamId, connectionId, limit),
  atlasListDatabaseChangeRequests: (teamId: string, connectionId: string, limit?: number) =>
    ipcRenderer.invoke('atlas:listDatabaseChangeRequests', teamId, connectionId, limit),
  atlasCreateDatabaseChangeRequest: (teamId: string, connectionId: string, input: unknown) =>
    ipcRenderer.invoke('atlas:createDatabaseChangeRequest', teamId, connectionId, input),
  atlasUpdateDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    changeId: string,
    patch: unknown,
  ) =>
    ipcRenderer.invoke('atlas:updateDatabaseChangeRequest', teamId, connectionId, changeId, patch),
  atlasDecideDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    changeId: string,
    action: 'submit' | 'approve' | 'reject' | 'cancel',
    comment?: string | null,
  ) =>
    ipcRenderer.invoke(
      'atlas:decideDatabaseChangeRequest',
      teamId,
      connectionId,
      changeId,
      action,
      comment,
    ),
  atlasExecuteDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    changeId: string,
    idempotencyKey: string,
  ) =>
    ipcRenderer.invoke(
      'atlas:executeDatabaseChangeRequest',
      teamId,
      connectionId,
      changeId,
      idempotencyKey,
    ),
}
