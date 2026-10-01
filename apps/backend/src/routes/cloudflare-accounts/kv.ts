import { z } from 'zod'

import {
  listKvNamespaces,
  createKvNamespace,
  renameKvNamespace,
  deleteKvNamespace,
  listKvKeys,
  readKvValue,
  writeKvValue,
  deleteKvValue,
} from '@/lib/byos/cloudflare-kv'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import {
  accountHandleFor,
  parseCloudflareIdParam,
  requireQueryKey,
} from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const kvNamespaceSchema = z.object({ title: z.string().trim().min(1).max(512) }).strict()

const kvWriteSchema = z
  .object({
    key: z.string().min(1).max(512),
    value: z.string().max(25 * 1024 * 1024),
    expirationTtl: z.number().int().min(60).max(2147483647).optional(),
  })
  .strict()

export function registerCloudflareKvRoutes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/kv/namespaces', async (c) => {
    const namespaces = await listKvNamespaces(await accountHandleFor(c))

    return c.json({ namespaces })
  })

  accountScoped.post(
    '/kv/namespaces',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', kvNamespaceSchema),
    async (c) => {
      const namespace = await createKvNamespace(
        await accountHandleFor(c),
        c.req.valid('json').title,
      )

      return c.json(namespace, 201)
    },
  )

  accountScoped.put(
    '/kv/namespaces/:namespaceId',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', kvNamespaceSchema),
    async (c) => {
      const namespaceId = parseCloudflareIdParam(c.req.param('namespaceId'), 'namespaceId')

      await renameKvNamespace(await accountHandleFor(c), namespaceId, c.req.valid('json').title)

      return c.body(null, 204)
    },
  )

  accountScoped.delete(
    '/kv/namespaces/:namespaceId',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const namespaceId = parseCloudflareIdParam(c.req.param('namespaceId'), 'namespaceId')

      await deleteKvNamespace(await accountHandleFor(c), namespaceId)

      return c.body(null, 204)
    },
  )

  accountScoped.get('/kv/namespaces/:namespaceId/keys', async (c) => {
    const namespaceId = parseCloudflareIdParam(c.req.param('namespaceId'), 'namespaceId')
    const page = await listKvKeys(await accountHandleFor(c), namespaceId, {
      prefix: c.req.query('prefix'),
      cursor: c.req.query('cursor') ?? null,
    })

    return c.json(page)
  })

  accountScoped.get('/kv/namespaces/:namespaceId/values', async (c) => {
    const namespaceId = parseCloudflareIdParam(c.req.param('namespaceId'), 'namespaceId')
    const key = requireQueryKey(c)
    const value = await readKvValue(await accountHandleFor(c), namespaceId, key)

    return c.json(value)
  })

  accountScoped.put(
    '/kv/namespaces/:namespaceId/values',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', kvWriteSchema),
    async (c) => {
      const namespaceId = parseCloudflareIdParam(c.req.param('namespaceId'), 'namespaceId')
      const { key, value, expirationTtl } = c.req.valid('json')

      await writeKvValue(await accountHandleFor(c), namespaceId, key, value, { expirationTtl })

      return c.body(null, 204)
    },
  )

  accountScoped.delete(
    '/kv/namespaces/:namespaceId/values',
    requireTeamRole('ADMINISTRATOR'),
    async (c) => {
      const namespaceId = parseCloudflareIdParam(c.req.param('namespaceId'), 'namespaceId')
      const key = requireQueryKey(c)

      await deleteKvValue(await accountHandleFor(c), namespaceId, key)

      return c.body(null, 204)
    },
  )
}
