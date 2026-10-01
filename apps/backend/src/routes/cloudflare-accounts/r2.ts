import { z } from 'zod'

import {
  listR2Buckets,
  createR2Bucket,
  deleteR2Bucket,
  getR2BucketUsage,
  getR2ManagedDomain,
  setR2ManagedDomain,
  listR2CustomDomains,
  addR2CustomDomain,
  deleteR2CustomDomain,
  verifyR2S3Credentials,
} from '@/lib/byos/cloudflare-r2'
import { encryptCloudflareApiKey } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'
import {
  accountHandleFor,
  cloudflareIdSchema,
  parseNameParam,
} from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const r2CredentialsSchema = z
  .object({
    accessKeyId: z.string().trim().min(1).max(128),
    secretAccessKey: z.string().trim().min(1).max(256),
  })
  .strict()

const r2BucketSchema = z
  .object({
    name: z.string().trim().min(3).max(63),
    locationHint: z.string().trim().max(16).optional(),
    storageClass: z.enum(['Standard', 'InfrequentAccess']).optional(),
  })
  .strict()

const r2ManagedDomainSchema = z.object({ enabled: z.boolean() }).strict()

const r2CustomDomainSchema = z
  .object({
    domain: z.string().trim().min(1).max(256),
    zoneId: cloudflareIdSchema,
    enabled: z.boolean().optional(),
  })
  .strict()

export function registerCloudflareR2Routes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/r2/s3-credentials', (c) => {
    const creds = c.get('cloudflareR2S3')

    return c.json({
      bound: !!creds,
      accessKeyId: creds?.accessKeyId ?? null,
      createdAt: creds?.createdAt ?? null,
    })
  })

  accountScoped.put(
    '/r2/s3-credentials',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', r2CredentialsSchema),
    async (c) => {
      const { accessKeyId, secretAccessKey } = c.req.valid('json')
      const accountId = c.get('cloudflareAccountId')

      try {
        await verifyR2S3Credentials({ accountId, accessKeyId, secretAccessKey })
      } catch (e) {
        throw new AppError(
          400,
          'invalid_r2_credentials',
          e instanceof Error ? e.message : 'R2 S3 credentials could not be verified',
        )
      }
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const createdAt = new Date()

      await teamByosBindings().updateOne(
        { _id: teamId },
        {
          $set: {
            'cloudflareAccounts.$[acct].r2S3': {
              accessKeyId,
              encryptedSecretAccessKey: encryptCloudflareApiKey(secretAccessKey),
              createdAt,
            },
            updatedAt: createdAt,
          },
        },
        { arrayFilters: [{ 'acct.accountId': accountId }] },
      )

      return c.json({ bound: true, accessKeyId, createdAt })
    },
  )

  accountScoped.delete('/r2/s3-credentials', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const accountId = c.get('cloudflareAccountId')

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $unset: { 'cloudflareAccounts.$[acct].r2S3': '' },
        $set: { updatedAt: new Date() },
      },
      { arrayFilters: [{ 'acct.accountId': accountId }] },
    )

    return c.body(null, 204)
  })

  accountScoped.get('/r2/buckets', async (c) => {
    const buckets = await listR2Buckets(await accountHandleFor(c))

    return c.json({ buckets })
  })

  accountScoped.post(
    '/r2/buckets',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', r2BucketSchema),
    async (c) => {
      const bucket = await createR2Bucket(await accountHandleFor(c), c.req.valid('json'))

      return c.json(bucket, 201)
    },
  )

  accountScoped.delete('/r2/buckets/:bucketName', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')

    await deleteR2Bucket(await accountHandleFor(c), bucketName)

    return c.body(null, 204)
  })

  accountScoped.get('/r2/buckets/:bucketName/usage', async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
    const usage = await getR2BucketUsage(await accountHandleFor(c), bucketName)

    return c.json(usage)
  })

  accountScoped.get('/r2/buckets/:bucketName/managed-domain', async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
    const managed = await getR2ManagedDomain(await accountHandleFor(c), bucketName)

    return c.json(managed)
  })

  accountScoped.put(
    '/r2/buckets/:bucketName/managed-domain',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', r2ManagedDomainSchema),
    async (c) => {
      const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
      const managed = await setR2ManagedDomain(
        await accountHandleFor(c),
        bucketName,
        c.req.valid('json').enabled,
      )

      return c.json(managed)
    },
  )

  accountScoped.get('/r2/buckets/:bucketName/custom-domains', async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
    const domains = await listR2CustomDomains(await accountHandleFor(c), bucketName)

    return c.json({ domains })
  })

  accountScoped.post(
    '/r2/buckets/:bucketName/custom-domains',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', r2CustomDomainSchema),
    async (c) => {
      const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')

      await addR2CustomDomain(await accountHandleFor(c), bucketName, c.req.valid('json'))

      return c.body(null, 201)
    },
  )

  accountScoped.delete(
    '/r2/buckets/:bucketName/custom-domains/:domain',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
      const domain = parseNameParam(c.req.param('domain'), 'domain')

      await deleteR2CustomDomain(await accountHandleFor(c), bucketName, domain)

      return c.body(null, 204)
    },
  )
}
