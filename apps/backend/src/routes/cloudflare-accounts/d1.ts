import { z } from 'zod'

import {
  listD1Databases,
  getD1Database,
  createD1Database,
  deleteD1Database,
  queryD1,
  listD1Tables,
} from '@/lib/byos/cloudflare-d1'
import { materializeCloudflareD1Connection } from '@/lib/database-provider-cloudflare'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { accountHandleFor, parseD1IdParam } from '@/routes/cloudflare-accounts/shared'

import type { CloudflareAccountVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

const d1CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    primaryLocationHint: z.string().trim().max(16).optional(),
  })
  .strict()

const d1QuerySchema = z
  .object({
    sql: z.string().min(1).max(100_000),
    params: z.array(z.string()).max(100).optional(),
  })
  .strict()

export function registerCloudflareD1Routes(
  accountScoped: Hono<{ Variables: CloudflareAccountVariables }>,
): void {
  accountScoped.get('/d1/databases', async (c) => {
    const databases = await listD1Databases(await accountHandleFor(c))

    return c.json({ databases })
  })

  accountScoped.post(
    '/d1/databases',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', d1CreateSchema),
    async (c) => {
      const database = await createD1Database(await accountHandleFor(c), c.req.valid('json'))

      return c.json(database, 201)
    },
  )

  accountScoped.get('/d1/databases/:databaseId', async (c) => {
    const databaseId = parseD1IdParam(c.req.param('databaseId'))
    const database = await getD1Database(await accountHandleFor(c), databaseId)

    return c.json(database)
  })

  accountScoped.post('/d1/databases/:databaseId/open-in-databases', async (c) => {
    const databaseId = parseD1IdParam(c.req.param('databaseId'))
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const startedAt = Date.now()
    const database = await getD1Database(await accountHandleFor(c), databaseId)
    const connection = await materializeCloudflareD1Connection({
      teamId,
      binding: c.get('cloudflareBinding'),
      database,
      userId: c.get('userId'),
      latencyMs: Date.now() - startedAt,
    })

    c.header('Cache-Control', 'no-store')

    return c.json({
      id: connection._id.toHexString(),
      name: connection.name,
      engine: connection.engine,
      environment: connection.environment,
      tags: connection.tags,
      endpoint: connection.endpoint,
      databaseName: connection.databaseName,
      tls: connection.tls,
      networkMode: connection.networkMode,
      providerOrigin: connection.providerOrigin
        ? {
            ...connection.providerOrigin,
            integrationId: connection.providerOrigin.integrationId.toHexString(),
          }
        : undefined,
      agentPolicy: connection.access.agentPolicy,
      relations: connection.relations,
      health: connection.health,
      canUse: true,
      access: {
        memberAllowList: connection.access.memberAllowList,
        updatedAt: connection.access.updatedAt,
        updatedBy: connection.access.updatedBy,
        agentPolicy: connection.access.agentPolicy,
      },
      changeApprovalPolicy: connection.changeApprovalPolicy,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    })
  })

  accountScoped.delete('/d1/databases/:databaseId', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const databaseId = parseD1IdParam(c.req.param('databaseId'))

    await deleteD1Database(await accountHandleFor(c), databaseId)

    return c.body(null, 204)
  })

  accountScoped.get('/d1/databases/:databaseId/tables', async (c) => {
    const databaseId = parseD1IdParam(c.req.param('databaseId'))
    const tables = await listD1Tables(await accountHandleFor(c), databaseId)

    return c.json({ tables })
  })

  accountScoped.post(
    '/d1/databases/:databaseId/query',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', d1QuerySchema),
    async (c) => {
      const databaseId = parseD1IdParam(c.req.param('databaseId'))
      const { sql, params } = c.req.valid('json')
      const result = await queryD1(await accountHandleFor(c), databaseId, sql, params)

      return c.json(result)
    },
  )
}
