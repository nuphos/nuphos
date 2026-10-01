import { databaseConnectionCoreOperations } from './database-connections/operations-core'
import { databaseMonitoringAndChangeOperations } from './database-connections/operations-monitoring-changes'

import type { ApiOperation } from './registry'

export {
  databaseAccessInputSchema,
  databaseAgentPolicySchema,
  databaseConnectionCreateSchema,
  databaseConnectionTestSchema,
  databaseConnectionUpdateSchema,
  databaseEngineSchema,
  databaseNetworkModeSchema,
  databaseRelationSchema,
  databaseTailscaleNetworkSchema,
} from './database-connections/connection-schemas'
export {
  databaseCatalogCollectionQuerySchema,
  databaseCatalogCollectionsQuerySchema,
  databaseCatalogQuerySchema,
  databaseChangeApprovalPolicySchema,
  databaseChangeDecisionSchema,
  databaseChangeExecuteSchema,
  databaseChangeRequestCreateSchema,
  databaseChangeRequestListSchema,
  databaseChangeRequestUpdateSchema,
  databaseMongoReadQuerySchema,
  databaseMonitoringHistoryQuerySchema,
  databaseQueryAuditListSchema,
  mongoChangeStatementSchema,
} from './database-connections/request-schemas'

export const databaseConnectionApiOperations = [
  ...databaseConnectionCoreOperations,
  ...databaseMonitoringAndChangeOperations,
] satisfies readonly ApiOperation[]
