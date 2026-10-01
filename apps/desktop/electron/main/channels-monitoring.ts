import * as atlas from '../atlas'

export const monitoringChannels = {
  'atlas:listBetterStackIntegrations': (_e: unknown, teamId: string) =>
    atlas.listBetterStackIntegrations(teamId),
  'atlas:bindBetterStackIntegration': (
    _e: unknown,
    teamId: string,
    label: string,
    uptimeApiToken: string | null,
    telemetryApiToken: string | null,
  ) => atlas.bindBetterStackIntegration(teamId, label, uptimeApiToken, telemetryApiToken),
  'atlas:updateBetterStackIntegration': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    patch: {
      label?: string
      uptimeApiToken?: string | null
      telemetryApiToken?: string | null
    },
  ) => atlas.updateBetterStackIntegration(teamId, integrationId, patch),
  'atlas:unbindBetterStackIntegration': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.unbindBetterStackIntegration(teamId, integrationId),
  'atlas:listBetterStackMonitors': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listBetterStackMonitors(teamId, integrationId),
  'atlas:listBetterStackHeartbeats': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listBetterStackHeartbeats(teamId, integrationId),
  'atlas:listBetterStackIncidents': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listBetterStackIncidents(teamId, integrationId),
  'atlas:listBetterStackDashboards': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listBetterStackDashboards(teamId, integrationId),
  'atlas:listBetterStackSources': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listBetterStackSources(teamId, integrationId),
  'atlas:listBetterStackCollectors': (_e: unknown, teamId: string, integrationId: string) =>
    atlas.listBetterStackCollectors(teamId, integrationId),
  'atlas:listUptimeKumaInstances': (_e: unknown, teamId: string) =>
    atlas.listUptimeKumaInstances(teamId),
  'atlas:listDatabaseConnections': (_e: unknown, teamId: string) =>
    atlas.listDatabaseConnections(teamId),
  'atlas:getDatabaseConnection': (_e: unknown, teamId: string, connectionId: string) =>
    atlas.getDatabaseConnection(teamId, connectionId),
  'atlas:getMongoDatabaseCatalog': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    refresh?: boolean,
  ) => atlas.getMongoDatabaseCatalog(teamId, connectionId, refresh),
  'atlas:getMongoCollectionCatalog': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    database: string,
    refresh?: boolean,
  ) => atlas.getMongoCollectionCatalog(teamId, connectionId, database, refresh),
  'atlas:getMongoCollectionDetail': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    database: string,
    collection: string,
    refresh?: boolean,
  ) => atlas.getMongoCollectionDetail(teamId, connectionId, database, collection, refresh),
  'atlas:queryMongoDatabase': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    input: atlas.MongoReadQueryInput,
  ) => atlas.queryMongoDatabase(teamId, connectionId, input),
  'atlas:getMongoMonitoringHistory': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    rangeMinutes?: number,
  ) => atlas.getMongoMonitoringHistory(teamId, connectionId, rangeMinutes),
  'atlas:sampleMongoMonitoring': (_e: unknown, teamId: string, connectionId: string) =>
    atlas.sampleMongoMonitoring(teamId, connectionId),
  'atlas:listDatabaseQueryAudit': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    limit?: number,
  ) => atlas.listDatabaseQueryAudit(teamId, connectionId, limit),
  'atlas:listDatabaseChangeRequests': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    limit?: number,
  ) => atlas.listDatabaseChangeRequests(teamId, connectionId, limit),
  'atlas:createDatabaseChangeRequest': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    input: atlas.DatabaseChangeRequestInput,
  ) => atlas.createDatabaseChangeRequest(teamId, connectionId, input),
  'atlas:updateDatabaseChangeRequest': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    changeId: string,
    patch: Partial<atlas.DatabaseChangeRequestInput>,
  ) => atlas.updateDatabaseChangeRequest(teamId, connectionId, changeId, patch),
  'atlas:decideDatabaseChangeRequest': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    changeId: string,
    action: 'submit' | 'approve' | 'reject' | 'cancel',
    comment?: string | null,
  ) => atlas.decideDatabaseChangeRequest(teamId, connectionId, changeId, action, comment),
  'atlas:executeDatabaseChangeRequest': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    changeId: string,
    idempotencyKey: string,
  ) => atlas.executeDatabaseChangeRequest(teamId, connectionId, changeId, idempotencyKey),
  'atlas:testDatabaseConnectionInput': (
    _e: unknown,
    teamId: string,
    input: Pick<
      atlas.DatabaseConnectionInput,
      'engine' | 'connectionUri' | 'networkMode' | 'tailscale'
    >,
  ) => atlas.testDatabaseConnectionInput(teamId, input),
  'atlas:createDatabaseConnection': (
    _e: unknown,
    teamId: string,
    input: atlas.DatabaseConnectionInput,
  ) => atlas.createDatabaseConnection(teamId, input),
  'atlas:updateDatabaseConnection': (
    _e: unknown,
    teamId: string,
    connectionId: string,
    patch: Partial<atlas.DatabaseConnectionInput>,
  ) => atlas.updateDatabaseConnection(teamId, connectionId, patch),
  'atlas:testStoredDatabaseConnection': (_e: unknown, teamId: string, connectionId: string) =>
    atlas.testStoredDatabaseConnection(teamId, connectionId),
  'atlas:deleteDatabaseConnection': (_e: unknown, teamId: string, connectionId: string) =>
    atlas.deleteDatabaseConnection(teamId, connectionId),
  'atlas:bindUptimeKumaInstance': (
    _e: unknown,
    teamId: string,
    input: {
      label: string
      baseUrl: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ) => atlas.bindUptimeKumaInstance(teamId, input),
  'atlas:updateUptimeKumaInstance': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    patch: {
      label?: string
      baseUrl?: string
      username?: string | null
      password?: string | null
      authToken?: string | null
    },
  ) => atlas.updateUptimeKumaInstance(teamId, instanceId, patch),
  'atlas:unbindUptimeKumaInstance': (_e: unknown, teamId: string, instanceId: string) =>
    atlas.unbindUptimeKumaInstance(teamId, instanceId),
  'atlas:listUptimeKumaMonitors': (_e: unknown, teamId: string, instanceId: string) =>
    atlas.listUptimeKumaMonitors(teamId, instanceId),
  'atlas:getUptimeKumaMonitor': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    monitorId: number,
  ) => atlas.getUptimeKumaMonitor(teamId, instanceId, monitorId),
  'atlas:createUptimeKumaMonitor': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    input: Record<string, unknown>,
  ) => atlas.createUptimeKumaMonitor(teamId, instanceId, input),
  'atlas:updateUptimeKumaMonitor': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    monitorId: number,
    patch: Record<string, unknown>,
  ) => atlas.updateUptimeKumaMonitor(teamId, instanceId, monitorId, patch),
  'atlas:pauseUptimeKumaMonitor': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    monitorId: number,
  ) => atlas.pauseUptimeKumaMonitor(teamId, instanceId, monitorId),
  'atlas:resumeUptimeKumaMonitor': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    monitorId: number,
  ) => atlas.resumeUptimeKumaMonitor(teamId, instanceId, monitorId),
  'atlas:getMonitoringOverview': (_e: unknown, teamId: string) =>
    atlas.getMonitoringOverview(teamId),
  'atlas:deleteBetterStackMonitor': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    monitorId: string,
  ) => atlas.deleteBetterStackMonitorById(teamId, integrationId, monitorId),
  'atlas:deleteBetterStackHeartbeat': (
    _e: unknown,
    teamId: string,
    integrationId: string,
    heartbeatId: string,
  ) => atlas.deleteBetterStackHeartbeatById(teamId, integrationId, heartbeatId),
  'atlas:deleteUptimeKumaMonitor': (
    _e: unknown,
    teamId: string,
    instanceId: string,
    monitorId: number,
    deleteChildren?: boolean,
  ) => atlas.deleteUptimeKumaMonitorById(teamId, instanceId, monitorId, deleteChildren),
} as const
