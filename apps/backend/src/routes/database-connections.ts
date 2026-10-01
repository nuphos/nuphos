import { Hono } from 'hono'

import { databaseConnectionAdminRoutes } from '@/routes/database-connections/admin'
import { databaseConnectionCatalogRoutes } from '@/routes/database-connections/catalog'
import { databaseConnectionChangeCrudRoutes } from '@/routes/database-connections/changes-crud'
import { databaseConnectionChangeDeclineRoutes } from '@/routes/database-connections/changes-decline'
import { databaseConnectionChangeExecuteRoutes } from '@/routes/database-connections/changes-execute'
import { databaseConnectionChangeReviewRoutes } from '@/routes/database-connections/changes-review'
import { databaseConnectionMonitoringRoutes } from '@/routes/database-connections/monitoring'
import { databaseConnectionQueryRoutes } from '@/routes/database-connections/query'
import { databaseConnectionRootRoutes } from '@/routes/database-connections/root'
import { requireDatabaseConnection } from '@/routes/database-connections/shared'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { ConnectionVariables } from '@/routes/database-connections/shared'

export const databaseConnectionsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

databaseConnectionsRoutes.route('/', databaseConnectionRootRoutes)

const connectionScoped = new Hono<{ Variables: ConnectionVariables }>()

connectionScoped.use('*', requireDatabaseConnection())
connectionScoped.route('/', databaseConnectionCatalogRoutes)
connectionScoped.route('/', databaseConnectionQueryRoutes)
connectionScoped.route('/', databaseConnectionMonitoringRoutes)
connectionScoped.route('/', databaseConnectionChangeCrudRoutes)
connectionScoped.route('/', databaseConnectionChangeReviewRoutes)
connectionScoped.route('/', databaseConnectionChangeDeclineRoutes)
connectionScoped.route('/', databaseConnectionChangeExecuteRoutes)
connectionScoped.route('/', databaseConnectionAdminRoutes)

databaseConnectionsRoutes.route('/:connectionId', connectionScoped)
