import { Hono } from 'hono'

import { registerDashboardAlertRoutes } from '@/routes/dashboards/alerts'
import { registerDashboardRoutes } from '@/routes/dashboards/dashboards'
import { registerDashboardExecutionRoutes } from '@/routes/dashboards/execution'
import {
  registerDashboardInsightFeedbackRoute,
  registerDashboardInsightRoutes,
} from '@/routes/dashboards/insights'
import { registerDashboardPanelRoutes } from '@/routes/dashboards/panels'

import type { TeamAuthVariables } from '@/middleware/auth'

export {
  appendScriptVersion,
  serializeDashboard,
  serializePanel,
  serializeSnapshot,
} from '@/routes/dashboards/serialize'

export const nuphosDashboardsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

registerDashboardRoutes(nuphosDashboardsRoutes)
registerDashboardPanelRoutes(nuphosDashboardsRoutes)
registerDashboardExecutionRoutes(nuphosDashboardsRoutes)
registerDashboardInsightRoutes(nuphosDashboardsRoutes)
registerDashboardAlertRoutes(nuphosDashboardsRoutes)
registerDashboardInsightFeedbackRoute(nuphosDashboardsRoutes)
