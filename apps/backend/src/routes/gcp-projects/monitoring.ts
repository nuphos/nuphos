import { z } from 'zod'

import { listGcpMetricDescriptors, queryGcpTimeSeries } from '@/lib/byos/gcp-monitoring'
import {
  getGcpMonitoringDashboard,
  listGcpMonitoringDashboards,
  queryGcpMonitoringDashboardWidget,
} from '@/lib/byos/gcp-monitoring-dashboards'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { handleFor } from './handle'

import type { GcpProjectVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const timeSeriesQuerySchema = z.object({
  metricType: z.string().trim().min(1),
  startMs: z.coerce.number().int().positive(),
  endMs: z.coerce.number().int().positive(),
  alignmentSec: z.coerce.number().int().min(60).max(86_400),
  aligner: z.string().trim().min(1),
  reducer: z.string().trim().optional(),
  // Comma-separated, e.g. "resource.zone,metric.instance_name".
  groupBy: z.string().trim().optional(),
})

const dashboardPathSchema = z.object({
  dashboardId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid dashboard id'),
})

const dashboardWidgetQueryPathSchema = dashboardPathSchema.extend({
  widgetRef: z
    .string()
    .trim()
    .regex(/^(?:mosaic|grid):\d+$|^(?:row|column):\d+:\d+$/, 'Invalid widget ref'),
})

const dashboardWidgetQuerySchema = z.object({
  datasetIndex: z.number().int().min(0).max(100),
  startMs: z.number().int().positive(),
  endMs: z.number().int().positive(),
  filters: z.record(z.string().max(128), z.string().max(256)).default({}),
})

// ---------------------------------------------------------------------------
// Cloud Monitoring (metrics explorer) — read-only pass-through.
// ---------------------------------------------------------------------------

export function registerGcpMonitoringRoutes(
  projectScoped: Hono<{ Variables: GcpProjectVariables }>,
): void {
  projectScoped.get('/monitoring/metric-descriptors', async (c) => {
    const descriptors = await listGcpMetricDescriptors(handleFor(c))

    return c.json({ descriptors })
  })

  projectScoped.get('/monitoring/timeseries', zv('query', timeSeriesQuerySchema), async (c) => {
    const q = c.req.valid('query')

    if (q.endMs <= q.startMs) {
      throw new AppError(400, 'invalid_range', 'endMs must be after startMs')
    }
    const result = await queryGcpTimeSeries(handleFor(c), {
      metricType: q.metricType,
      startMs: q.startMs,
      endMs: q.endMs,
      alignmentSec: q.alignmentSec,
      aligner: q.aligner,
      reducer: q.reducer,
      groupByFields: q.groupBy
        ? q.groupBy
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    })

    return c.json(result)
  })

  // Custom Monitoring dashboards stay provider-owned. The desktop receives a
  // normalized read-only definition, then identifies a saved widget/dataset when
  // requesting data; the backend reloads and executes that exact provider query.
  projectScoped.get('/monitoring/dashboards', async (c) => {
    const dashboards = await listGcpMonitoringDashboards(handleFor(c))

    return c.json({ dashboards })
  })

  projectScoped.get(
    '/monitoring/dashboards/:dashboardId',
    zv('param', dashboardPathSchema),
    async (c) => {
      const { dashboardId } = c.req.valid('param')

      return c.json(await getGcpMonitoringDashboard(handleFor(c), dashboardId))
    },
  )

  projectScoped.post(
    '/monitoring/dashboards/:dashboardId/widgets/:widgetRef/query',
    zv('param', dashboardWidgetQueryPathSchema),
    zv('json', dashboardWidgetQuerySchema),
    async (c) => {
      const { dashboardId, widgetRef } = c.req.valid('param')
      const input = c.req.valid('json')

      if (input.endMs <= input.startMs) {
        throw new AppError(400, 'invalid_range', 'endMs must be after startMs')
      }

      return c.json(
        await queryGcpMonitoringDashboardWidget(handleFor(c), dashboardId, {
          widgetRef,
          ...input,
        }),
      )
    },
  )
}
