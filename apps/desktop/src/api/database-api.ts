import type { DatabaseChangeRequestInput, DatabaseConnectionInput } from '../types/database.ts'
import type { MongoReadQueryInput } from '../types/mongo-monitoring.ts'

export const databaseApi = {
  atlasListDatabaseConnections: (teamId: string) => window.api.atlasListDatabaseConnections(teamId),
  atlasGetDatabaseConnection: (teamId: string, connectionId: string) =>
    window.api.atlasGetDatabaseConnection(teamId, connectionId),
  atlasGetMongoDatabaseCatalog: (teamId: string, connectionId: string, refresh?: boolean) =>
    window.api.atlasGetMongoDatabaseCatalog(teamId, connectionId, refresh),
  atlasGetMongoCollectionCatalog: (
    teamId: string,
    connectionId: string,
    database: string,
    refresh?: boolean,
  ) => window.api.atlasGetMongoCollectionCatalog(teamId, connectionId, database, refresh),
  atlasGetMongoCollectionDetail: (
    teamId: string,
    connectionId: string,
    database: string,
    collection: string,
    refresh?: boolean,
  ) =>
    window.api.atlasGetMongoCollectionDetail(teamId, connectionId, database, collection, refresh),
  atlasQueryMongoDatabase: (teamId: string, connectionId: string, input: MongoReadQueryInput) =>
    window.api.atlasQueryMongoDatabase(teamId, connectionId, input),
  atlasGetMongoMonitoringHistory: (teamId: string, connectionId: string, rangeMinutes?: number) =>
    window.api.atlasGetMongoMonitoringHistory(teamId, connectionId, rangeMinutes),
  atlasSampleMongoMonitoring: (teamId: string, connectionId: string) =>
    window.api.atlasSampleMongoMonitoring(teamId, connectionId),
  atlasListDatabaseQueryAudit: (teamId: string, connectionId: string, limit?: number) =>
    window.api.atlasListDatabaseQueryAudit(teamId, connectionId, limit),
  atlasListDatabaseChangeRequests: (teamId: string, connectionId: string, limit?: number) =>
    window.api.atlasListDatabaseChangeRequests(teamId, connectionId, limit),
  atlasCreateDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    input: DatabaseChangeRequestInput,
  ) => window.api.atlasCreateDatabaseChangeRequest(teamId, connectionId, input),
  atlasUpdateDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    changeId: string,
    patch: Partial<DatabaseChangeRequestInput>,
  ) => window.api.atlasUpdateDatabaseChangeRequest(teamId, connectionId, changeId, patch),
  atlasDecideDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    changeId: string,
    action: 'submit' | 'approve' | 'reject' | 'cancel',
    comment?: string | null,
  ) => window.api.atlasDecideDatabaseChangeRequest(teamId, connectionId, changeId, action, comment),
  atlasExecuteDatabaseChangeRequest: (
    teamId: string,
    connectionId: string,
    changeId: string,
    idempotencyKey: string,
  ) => window.api.atlasExecuteDatabaseChangeRequest(teamId, connectionId, changeId, idempotencyKey),
  atlasTestDatabaseConnectionInput: (
    teamId: string,
    input: Pick<DatabaseConnectionInput, 'engine' | 'connectionUri' | 'networkMode' | 'tailscale'>,
  ) => window.api.atlasTestDatabaseConnectionInput(teamId, input),
  atlasCreateDatabaseConnection: (teamId: string, input: DatabaseConnectionInput) =>
    window.api.atlasCreateDatabaseConnection(teamId, input),
  atlasUpdateDatabaseConnection: (
    teamId: string,
    connectionId: string,
    patch: Partial<DatabaseConnectionInput>,
  ) => window.api.atlasUpdateDatabaseConnection(teamId, connectionId, patch),
  atlasTestStoredDatabaseConnection: (teamId: string, connectionId: string) =>
    window.api.atlasTestStoredDatabaseConnection(teamId, connectionId),
  atlasDeleteDatabaseConnection: (teamId: string, connectionId: string) =>
    window.api.atlasDeleteDatabaseConnection(teamId, connectionId),
}
