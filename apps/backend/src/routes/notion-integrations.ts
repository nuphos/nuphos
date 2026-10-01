import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import {
  NOTION_VERSION,
  NotionApiError,
  tokenFromBinding,
  verifyNotionToken,
} from '@/lib/byos/notion'
import { encryptNotionSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import {
  requireNotionIntegration,
  requireNotionMemberAccess,
  requireTeamRole,
} from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { NotionIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { NotionIntegrationBinding } from '@/models'

export const notionIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Notion binds with a static internal-integration token (Settings & members →
// Connections → Develop or manage integrations → New integration → Internal
// Integration Secret, "ntn_…" / legacy "secret_…"). No OAuth. The user must also
// share the pages/databases with the integration for it to see anything.
const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    token: z.string().trim().min(1).max(300),
  })
  .strict()

export function publicView(binding: NotionIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    workspaceName: binding.workspaceName,
    createdAt: binding.createdAt,
  }
}

notionIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { notionIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.notionIntegrations ?? []).map(publicView) })
})

notionIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, token } = c.req.valid('json')

    const info = await verifyNotionToken(token).catch((err: unknown) => {
      if (err instanceof NotionApiError && (err.status === 401 || err.status === 403)) {
        throw new AppError(
          400,
          'invalid_notion_token',
          'The Notion integration token is invalid or has been revoked.',
        )
      }
      const message = err instanceof Error ? err.message : 'unknown error'

      throw new AppError(
        502,
        'notion_api_unavailable',
        `Could not reach the Notion API: ${message}`,
      )
    })

    const now = new Date()
    const binding: NotionIntegrationBinding = {
      id: new ObjectId(),
      label,
      workspaceName: info.workspaceName,
      botId: info.botId,
      encryptedToken: encryptNotionSecret(token),
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { notionIntegrations: binding },
        $set: { updatedAt: now },
        $setOnInsert: {
          awsRoles: [],
          gcpServiceAccounts: [],
          grafanaInstances: [],
          githubInstallations: [],
          cloudflareAccounts: [],
          tailscaleClients: [],
          zeaburProviders: [],
        },
      },
      { upsert: true },
    )

    return c.json(publicView(binding), 201)
  },
)

const integrationScoped = new Hono<{ Variables: NotionIntegrationVariables }>()

integrationScoped.use('*', requireNotionIntegration())

integrationScoped.get('/', (c) => {
  const binding = c.get('notionBinding')

  return c.json({
    id: c.get('notionIntegrationId'),
    label: c.get('notionIntegrationLabel'),
    workspaceName: binding.workspaceName,
  })
})

integrationScoped.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const integrationId = new ObjectId(c.get('notionIntegrationId'))
  const result = await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $pull: { notionIntegrations: { id: integrationId } },
      $set: { updatedAt: new Date() },
    },
  )

  if (result.modifiedCount === 0) {
    throw new AppError(404, 'notion_integration_not_bound', 'Notion integration not found')
  }

  return c.body(null, 204)
})

// Agent credential handout, mirroring linear-workspaces /credentials: the
// sandbox exchanges its NUPHOS_TOKEN for the binding's Notion token and talks to
// api.notion.com directly. Gated by the per-binding member allow-list. Unlike
// Secureframe (read-only server-side proxy), Notion is a full read/write surface
// the agent drives itself, so it needs the raw token.
integrationScoped.get('/credentials', requireNotionMemberAccess(), (c) => {
  const binding = c.get('notionBinding')
  const accessToken = tokenFromBinding(binding)

  // A reusable bearer token over GET must never be cached by intermediaries.
  c.header('Cache-Control', 'no-store, private')
  c.header('Pragma', 'no-cache')

  return c.json({
    bindingId: binding.id.toHexString(),
    workspaceName: binding.workspaceName,
    accessToken,
    notionVersion: NOTION_VERSION,
    authType: 'notion_bearer',
  })
})

notionIntegrationsRoutes.route('/:integrationId', integrationScoped)
