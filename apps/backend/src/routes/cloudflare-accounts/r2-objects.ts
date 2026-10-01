import { z } from 'zod'

import {
  listR2Objects,
  getR2ObjectDownloadUrl,
  getR2ObjectTextPreview,
  putR2Object,
  deleteR2Object,
} from '@/lib/byos/cloudflare-r2'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { parseNameParam, r2S3HandleFor, requireQueryKey } from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const r2PutObjectSchema = z
  .object({
    key: z.string().trim().min(1).max(1024),
    contentBase64: z.string().max(20 * 1024 * 1024),
    contentType: z.string().trim().max(256).optional(),
  })
  .strict()

export function registerCloudflareR2ObjectRoutes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/r2/buckets/:bucketName/objects', async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
    const prefix = c.req.query('prefix') ?? ''
    const cursor = c.req.query('cursor') ?? null
    const listing = await listR2Objects(r2S3HandleFor(c), bucketName, prefix, cursor)

    return c.json(listing)
  })

  accountScoped.get('/r2/buckets/:bucketName/objects/download', async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
    const key = requireQueryKey(c)
    const url = await getR2ObjectDownloadUrl(r2S3HandleFor(c), bucketName, key)

    return c.json({ url })
  })

  accountScoped.get('/r2/buckets/:bucketName/objects/preview', async (c) => {
    const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
    const key = requireQueryKey(c)
    const preview = await getR2ObjectTextPreview(r2S3HandleFor(c), bucketName, key)

    return c.json(preview)
  })

  accountScoped.post(
    '/r2/buckets/:bucketName/objects',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', r2PutObjectSchema),
    async (c) => {
      const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
      const { key, contentBase64, contentType } = c.req.valid('json')
      const body = new Uint8Array(Buffer.from(contentBase64, 'base64'))

      await putR2Object(r2S3HandleFor(c), bucketName, key, body, contentType ?? null)

      return c.body(null, 201)
    },
  )

  accountScoped.delete(
    '/r2/buckets/:bucketName/objects',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const bucketName = parseNameParam(c.req.param('bucketName'), 'bucketName')
      const key = requireQueryKey(c)

      await deleteR2Object(r2S3HandleFor(c), bucketName, key)

      return c.body(null, 204)
    },
  )
}
