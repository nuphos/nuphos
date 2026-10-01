import { z } from 'zod'

import { listEksClusters, generateEksKubeconfig } from '@/lib/byos/aws'
import {
  getLightsailInstanceSshAccess,
  listLightsailInstances,
  rebootLightsailInstance,
} from '@/lib/byos/aws-lightsail'
import {
  listS3Buckets,
  listS3BucketObjects,
  getS3ObjectDownloadUrl,
  getS3ObjectTextPreview,
} from '@/lib/byos/aws-s3'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { optionalRegionQuerySchema } from '@/routes/aws-accounts/schemas'

import type { AwsAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const lightsailInstanceActionSchema = z.object({
  region: z.string().trim().min(1),
})

export function registerAwsResourceRoutes(
  accountScoped: Hono<{ Variables: AwsAccountVariables }>,
): void {
  accountScoped.get('/lightsail-instances', zv('query', optionalRegionQuerySchema), async (c) => {
    const { region } = c.req.valid('query')
    const result = await listLightsailInstances(
      c.get('awsRoleArn'),
      region ? { region } : undefined,
    )

    return c.json(result)
  })

  accountScoped.post(
    '/lightsail-instances/:name/reboot',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', lightsailInstanceActionSchema),
    async (c) => {
      const name = c.req.param('name')
      const { region } = c.req.valid('json')

      await rebootLightsailInstance(c.get('awsRoleArn'), region, name)

      return c.body(null, 204)
    },
  )

  accountScoped.post(
    '/lightsail-instances/:name/ssh-access',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', lightsailInstanceActionSchema),
    async (c) => {
      const name = c.req.param('name')
      const { region } = c.req.valid('json')
      const access = await getLightsailInstanceSshAccess(c.get('awsRoleArn'), region, name)

      return c.json(access)
    },
  )

  accountScoped.get('/clusters', async (c) => {
    const result = await listEksClusters(c.get('awsRoleArn'))

    return c.json(result)
  })

  accountScoped.get('/s3-buckets', async (c) => {
    const buckets = await listS3Buckets(c.get('awsRoleArn'))

    return c.json({ buckets })
  })

  accountScoped.get('/s3-buckets/:bucket/objects', async (c) => {
    const bucket = c.req.param('bucket')
    const region = c.req.query('region') ?? ''
    const prefix = c.req.query('prefix') ?? ''
    const continuationToken = c.req.query('continuationToken') ?? null
    const listing = await listS3BucketObjects(
      c.get('awsRoleArn'),
      bucket,
      region,
      prefix,
      continuationToken,
    )

    return c.json(listing)
  })

  accountScoped.get('/s3-buckets/:bucket/object-url', async (c) => {
    const bucket = c.req.param('bucket')
    const region = c.req.query('region') ?? ''
    const key = c.req.query('key') ?? ''

    if (!key) throw new AppError(400, 'invalid_request', 'key query parameter is required')
    const url = await getS3ObjectDownloadUrl(c.get('awsRoleArn'), bucket, region, key)

    return c.json({ url })
  })

  accountScoped.get('/s3-buckets/:bucket/object-preview', async (c) => {
    const bucket = c.req.param('bucket')
    const region = c.req.query('region') ?? ''
    const key = c.req.query('key') ?? ''

    if (!key) throw new AppError(400, 'invalid_request', 'key query parameter is required')
    const preview = await getS3ObjectTextPreview(c.get('awsRoleArn'), bucket, region, key)

    return c.json(preview)
  })

  accountScoped.get('/clusters/:name/kubeconfig', async (c) => {
    const name = c.req.param('name')
    const roleArn = c.get('awsRoleArn')
    let region = c.req.query('region') || undefined

    if (!region) {
      const list = await listEksClusters(roleArn)
      const found = list.clusters.find((cl) => cl.name === name)

      if (!found) {
        throw new AppError(404, 'cluster_not_found', `Cluster ${name} not found in this account`)
      }
      region = found.region
    }

    const result = await generateEksKubeconfig(roleArn, region, name, {
      source: 'aws-accounts.clusters.kubeconfig',
      userId: c.get('userId'),
      userEmail: c.get('userEmail'),
      teamId: c.get('teamId'),
    })

    if (!result) {
      throw new AppError(404, 'cluster_not_found', `Cluster ${name} not found in ${region}`)
    }

    c.header('Content-Type', 'application/yaml; charset=utf-8')
    c.header('X-Kubeconfig-Expires-At', result.expiresAt.toISOString())

    return c.body(result.kubeconfig)
  })
}
