import { Hono } from 'hono'

import { registerGcpBindingRoutes } from '@/routes/gcp-projects/bindings'
import { gcpProjectScoped } from '@/routes/gcp-projects/project-scoped'

import type { TeamAuthVariables } from '@/middleware/auth'

export { gcpProjectsView } from '@/routes/gcp-projects/bindings'

export const gcpProjectsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

registerGcpBindingRoutes(gcpProjectsRoutes)

gcpProjectsRoutes.route('/:projectId', gcpProjectScoped)
