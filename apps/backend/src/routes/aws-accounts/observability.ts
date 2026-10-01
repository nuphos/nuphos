import { z } from 'zod'

import {
  listCloudWatchAlarms,
  listCloudWatchMetrics,
  getCloudWatchMetricData,
  getCloudWatchAlarmHistory,
} from '@/lib/byos/aws-cloudwatch'
import {
  listLogGroups,
  getLogGroupEvents,
  searchLogGroupEvents,
  listLogStreams,
  setLogGroupRetention,
} from '@/lib/byos/aws-cloudwatch-logs'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { optionalRegionQuerySchema } from '@/routes/aws-accounts/schemas'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const logSearchQuerySchema = z.object({
  region: z.string().trim().min(1),
  name: z.string().trim().min(1),
  pattern: z.string().optional(),
  startTime: z.coerce.number().int().optional(),
  endTime: z.coerce.number().int().optional(),
  stream: z.string().optional(),
  nextToken: z.string().optional(),
})

const logStreamsQuerySchema = z.object({
  region: z.string().trim().min(1),
  name: z.string().trim().min(1),
  nextToken: z.string().optional(),
})

// PutRetentionPolicy only accepts this fixed set of day counts; null means
// DeleteRetentionPolicy ("never expire").
const LOG_RETENTION_ALLOWED_DAYS = [
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288,
  3653,
] as const

const metricListQuerySchema = z.object({
  region: z.string().trim().min(1),
  namespace: z.string().optional(),
  metricName: z.string().optional(),
})

const metricDataQuerySchema = z.object({
  region: z.string().trim().min(1),
  namespace: z.string().trim().min(1),
  metricName: z.string().trim().min(1),
  // JSON-encoded Record<string,string> — dimension values can contain
  // arbitrary characters, so structured query params are not an option.
  dimensions: z.string().transform((s, ctx) => {
    let parsed: unknown

    try {
      parsed = JSON.parse(s)
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dimensions must be valid JSON' })

      return z.NEVER
    }
    const result = z.record(z.string(), z.string()).safeParse(parsed)

    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dimensions must be a JSON object with string values',
      })

      return z.NEVER
    }

    return result.data
  }),
  stat: z.enum(['Average', 'Sum', 'Maximum', 'Minimum']),
  rangeMinutes: z.coerce.number().int().min(5).max(10080).optional(),
})

const alarmHistoryQuerySchema = z.object({
  region: z.string().trim().min(1),
  name: z.string().trim().min(1),
})

// Log group names contain slashes, so the group is addressed via query params
// (mirroring how S3 object keys are passed) rather than a path segment.
const logGroupEventsQuerySchema = z.object({
  region: z.string().trim().min(1),
  name: z.string().trim().min(1),
})

export function registerAwsObservabilityRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/cloudwatch-alarms', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const alarms = await listCloudWatchAlarms(c.get('awsRoleArn'), region ? { region } : undefined)

    return c.json({ alarms })
  })

  accountScoped.get('/log-groups/search', zv('query', logSearchQuerySchema), async (c) => {
    const { region, name, pattern, startTime, endTime, stream, nextToken } = c.req.valid('query')
    const result = await searchLogGroupEvents(c.get('awsRoleArn'), region, name, {
      pattern,
      startTimeMs: startTime,
      endTimeMs: endTime,
      logStreamName: stream,
      nextToken,
    })

    return c.json(result)
  })

  accountScoped.get('/log-groups/streams', zv('query', logStreamsQuerySchema), async (c) => {
    const { region, name, nextToken } = c.req.valid('query')
    const result = await listLogStreams(c.get('awsRoleArn'), region, name, { nextToken })

    return c.json(result)
  })

  accountScoped.put(
    '/log-groups/retention',
    requireTeamRole('ADMINISTRATOR'),
    zv(
      'json',
      z.object({
        region: z.string().trim().min(1),
        name: z.string().trim().min(1),
        retentionDays: z
          .number()
          .int()
          .nullable()
          .refine(
            (v) => v === null || (LOG_RETENTION_ALLOWED_DAYS as readonly number[]).includes(v),
            {
              message: `retentionDays must be null or one of ${LOG_RETENTION_ALLOWED_DAYS.join(', ')}`,
            },
          ),
      }),
    ),
    async (c) => {
      const { region, name, retentionDays } = c.req.valid('json')

      await setLogGroupRetention(c.get('awsRoleArn'), region, name, retentionDays)

      return c.body(null, 204)
    },
  )

  accountScoped.get('/cloudwatch-metrics', zv('query', metricListQuerySchema), async (c) => {
    const { region, namespace, metricName } = c.req.valid('query')
    const result = await listCloudWatchMetrics(c.get('awsRoleArn'), region, {
      namespace,
      metricName,
    })

    return c.json(result)
  })

  accountScoped.get('/cloudwatch-metric-data', zv('query', metricDataQuerySchema), async (c) => {
    const { region, namespace, metricName, dimensions, stat, rangeMinutes } = c.req.valid('query')
    const data = await getCloudWatchMetricData(c.get('awsRoleArn'), region, {
      namespace,
      metricName,
      dimensions,
      stat,
      rangeMinutes,
    })

    return c.json(data)
  })

  accountScoped.get(
    '/cloudwatch-alarms/history',
    zv('query', alarmHistoryQuerySchema),
    async (c) => {
      const { region, name } = c.req.valid('query')
      const items = await getCloudWatchAlarmHistory(c.get('awsRoleArn'), region, name)

      return c.json({ items })
    },
  )

  accountScoped.get('/log-groups', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const logGroups = await listLogGroups(c.get('awsRoleArn'), region ? { region } : undefined)

    return c.json({ logGroups })
  })

  accountScoped.get('/log-groups/events', zv('query', logGroupEventsQuerySchema), async (c) => {
    const { region, name } = c.req.valid('query')
    const result = await getLogGroupEvents(c.get('awsRoleArn'), region, name)

    return c.json(result)
  })
}
