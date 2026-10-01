import { z } from 'zod'

import { listCfnStacks } from '@/lib/byos/aws-cfn'
import {
  listEcsClusters,
  listEcsServices,
  listEcsTasks,
  listEcsContainerInstances,
  getEcsClusterMetrics,
} from '@/lib/byos/aws-ecs'
import {
  listLambdaFunctions,
  getLambdaFunctionDetail,
  getLambdaFunctionMetrics,
  invokeLambdaFunction,
  updateLambdaFunctionConfig,
  listLambdaTriggers,
} from '@/lib/byos/aws-lambda'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { optionalRegionQuerySchema } from '@/routes/aws-accounts/schemas'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const ecsClusterScopeSchema = z.object({
  region: z.string().trim().min(1),
  cluster: z.string().trim().min(1),
})

const ecsTaskQuerySchema = z.object({
  desiredStatus: z.enum(['RUNNING', 'STOPPED']).optional(),
})

const ecsMetricsQuerySchema = z.object({
  rangeMinutes: z.coerce.number().int().min(5).max(1440).optional(),
})

// Function detail/metrics use query params (region + name) like the
// log-group endpoints, keeping the path free of encoding edge cases.
const lambdaFunctionQuerySchema = z.object({
  region: z.string().trim().min(1),
  name: z.string().trim().min(1),
})

const lambdaMetricsQuerySchema = lambdaFunctionQuerySchema.extend({
  rangeMinutes: z.coerce.number().int().min(5).max(1440).optional(),
})

export function registerAwsComputeRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/ecs-clusters', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const clusters = await listEcsClusters(c.get('awsRoleArn'), region ? { region } : undefined)

    return c.json({ clusters })
  })

  accountScoped.get(
    '/ecs-clusters/:region/:cluster/services',
    zv('param', ecsClusterScopeSchema),
    async (c) => {
      const { region, cluster } = c.req.valid('param')
      const services = await listEcsServices(c.get('awsRoleArn'), region, cluster)

      return c.json({ services })
    },
  )

  accountScoped.get(
    '/ecs-clusters/:region/:cluster/tasks',
    zv('param', ecsClusterScopeSchema),
    zv('query', ecsTaskQuerySchema),
    async (c) => {
      const { region, cluster } = c.req.valid('param')
      const { desiredStatus } = c.req.valid('query')
      const tasks = await listEcsTasks(c.get('awsRoleArn'), region, cluster, { desiredStatus })

      return c.json({ tasks })
    },
  )

  accountScoped.get(
    '/ecs-clusters/:region/:cluster/container-instances',
    zv('param', ecsClusterScopeSchema),
    async (c) => {
      const { region, cluster } = c.req.valid('param')
      const instances = await listEcsContainerInstances(c.get('awsRoleArn'), region, cluster)

      return c.json({ instances })
    },
  )

  accountScoped.get(
    '/ecs-clusters/:region/:cluster/metrics',
    zv('param', ecsClusterScopeSchema),
    zv('query', ecsMetricsQuerySchema),
    async (c) => {
      const { region, cluster } = c.req.valid('param')
      const { rangeMinutes } = c.req.valid('query')
      const metrics = await getEcsClusterMetrics(c.get('awsRoleArn'), region, cluster, {
        rangeMinutes,
      })

      return c.json(metrics)
    },
  )

  accountScoped.get('/cfn-stacks', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const stacks = await listCfnStacks(c.get('awsRoleArn'), region ? { region } : undefined)

    return c.json({ stacks })
  })

  accountScoped.get('/lambda-functions', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const functions = await listLambdaFunctions(
      c.get('awsRoleArn'),
      region ? { region } : undefined,
    )

    return c.json({ functions })
  })

  accountScoped.get(
    '/lambda-functions/function',
    zv('query', lambdaFunctionQuerySchema),
    async (c) => {
      const { region, name } = c.req.valid('query')
      const detail = await getLambdaFunctionDetail(c.get('awsRoleArn'), region, name)

      return c.json(detail)
    },
  )

  accountScoped.get(
    '/lambda-functions/function/metrics',
    zv('query', lambdaMetricsQuerySchema),
    async (c) => {
      const { region, name, rangeMinutes } = c.req.valid('query')
      const metrics = await getLambdaFunctionMetrics(c.get('awsRoleArn'), region, name, {
        rangeMinutes,
      })

      return c.json(metrics)
    },
  )

  accountScoped.post(
    '/lambda-functions/function/invoke',
    requireTeamRole('ADMINISTRATOR'),
    zv(
      'json',
      z.object({
        region: z.string().trim().min(1),
        name: z.string().trim().min(1),
        payload: z.string().max(256 * 1024),
      }),
    ),
    async (c) => {
      const { region, name, payload } = c.req.valid('json')
      const result = await invokeLambdaFunction(c.get('awsRoleArn'), region, name, payload)

      return c.json(result)
    },
  )

  accountScoped.patch(
    '/lambda-functions/function/config',
    requireTeamRole('ADMINISTRATOR'),
    zv(
      'json',
      z.object({
        region: z.string().trim().min(1),
        name: z.string().trim().min(1),
        memoryMb: z.number().int().min(128).max(10240).optional(),
        timeoutSec: z.number().int().min(1).max(900).optional(),
        environment: z.record(z.string(), z.string()).optional(),
      }),
    ),
    async (c) => {
      const { region, name, memoryMb, timeoutSec, environment } = c.req.valid('json')

      await updateLambdaFunctionConfig(c.get('awsRoleArn'), region, name, {
        memoryMb,
        timeoutSec,
        environment,
      })

      return c.body(null, 204)
    },
  )

  accountScoped.get(
    '/lambda-functions/function/triggers',
    zv('query', lambdaFunctionQuerySchema),
    async (c) => {
      const { region, name } = c.req.valid('query')
      const triggers = await listLambdaTriggers(c.get('awsRoleArn'), region, name)

      return c.json(triggers)
    },
  )
}
