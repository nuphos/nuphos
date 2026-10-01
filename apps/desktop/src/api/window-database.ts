import type {
  DatabaseChangeRequest,
  DatabaseChangeRequestInput,
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseConnectionTestResult,
  MongoDatabaseCatalog,
} from '../types/database.ts'
import type {
  DatabaseQueryAudit,
  DatabaseQueryResult,
  MongoCollectionCatalog,
  MongoCollectionDetail,
  MongoMonitoringHistory,
  MongoMonitoringSample,
  MongoReadQueryInput,
} from '../types/mongo-monitoring.ts'

export type WindowDatabaseApi = {
  atlasListDatabaseConnections(teamId: string): Promise<DatabaseConnection[]>
  atlasGetDatabaseConnection(teamId: string, connectionId: string): Promise<DatabaseConnection>
  atlasGetMongoDatabaseCatalog(
    teamId: string,
    connectionId: string,
    refresh?: boolean,
  ): Promise<MongoDatabaseCatalog>
  atlasGetMongoCollectionCatalog(
    teamId: string,
    connectionId: string,
    database: string,
    refresh?: boolean,
  ): Promise<MongoCollectionCatalog>
  atlasGetMongoCollectionDetail(
    teamId: string,
    connectionId: string,
    database: string,
    collection: string,
    refresh?: boolean,
  ): Promise<MongoCollectionDetail>
  atlasQueryMongoDatabase(
    teamId: string,
    connectionId: string,
    input: MongoReadQueryInput,
  ): Promise<DatabaseQueryResult>
  atlasGetMongoMonitoringHistory(
    teamId: string,
    connectionId: string,
    rangeMinutes?: number,
  ): Promise<MongoMonitoringHistory>
  atlasSampleMongoMonitoring(teamId: string, connectionId: string): Promise<MongoMonitoringSample>
  atlasListDatabaseQueryAudit(
    teamId: string,
    connectionId: string,
    limit?: number,
  ): Promise<DatabaseQueryAudit[]>
  atlasListDatabaseChangeRequests(
    teamId: string,
    connectionId: string,
    limit?: number,
  ): Promise<DatabaseChangeRequest[]>
  atlasCreateDatabaseChangeRequest(
    teamId: string,
    connectionId: string,
    input: DatabaseChangeRequestInput,
  ): Promise<DatabaseChangeRequest>
  atlasUpdateDatabaseChangeRequest(
    teamId: string,
    connectionId: string,
    changeId: string,
    patch: Partial<DatabaseChangeRequestInput>,
  ): Promise<DatabaseChangeRequest>
  atlasDecideDatabaseChangeRequest(
    teamId: string,
    connectionId: string,
    changeId: string,
    action: 'submit' | 'approve' | 'reject' | 'cancel',
    comment?: string | null,
  ): Promise<DatabaseChangeRequest>
  atlasExecuteDatabaseChangeRequest(
    teamId: string,
    connectionId: string,
    changeId: string,
    idempotencyKey: string,
  ): Promise<DatabaseChangeRequest>
  atlasTestDatabaseConnectionInput(
    teamId: string,
    input: Pick<DatabaseConnectionInput, 'engine' | 'connectionUri' | 'networkMode' | 'tailscale'>,
  ): Promise<DatabaseConnectionTestResult>
  atlasCreateDatabaseConnection(
    teamId: string,
    input: DatabaseConnectionInput,
  ): Promise<DatabaseConnection>
  atlasUpdateDatabaseConnection(
    teamId: string,
    connectionId: string,
    patch: Partial<DatabaseConnectionInput>,
  ): Promise<DatabaseConnection>
  atlasTestStoredDatabaseConnection(
    teamId: string,
    connectionId: string,
  ): Promise<DatabaseConnection>
  atlasDeleteDatabaseConnection(teamId: string, connectionId: string): Promise<void>
}
