import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { createDefaultAccess } from '@/lib/byos/access'
import { encryptSonarqubeSecret } from '@/lib/byos/secrets'
import { blockedSonarqubeBaseUrlReason, verifySonarqubeCredentials } from '@/lib/byos/sonarqube'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireSonarqubeIntegration, requireTeamRole } from '@/middleware/auth'
import { emptyTeamByosBindings, teamByosBindings } from '@/models'
import { registerSonarqubeScopedRoutes } from '@/routes/sonarqube-integrations/scoped'
import { mapSonarqubeError, sonarqubePublicView } from '@/routes/sonarqube-integrations/shared'

import type { SonarqubeIntegrationVariables, TeamAuthVariables } from '@/middleware/auth'
import type { SonarqubeIntegrationBinding } from '@/models'

export { sonarqubePublicView } from '@/routes/sonarqube-integrations/shared'

export const sonarqubeIntegrationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    baseUrl: z
      .string()
      .url()
      .superRefine((value, ctx) => {
        const reason = blockedSonarqubeBaseUrlReason(value)

        if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason })
      }),
    token: z.string().trim().min(1).max(512),
  })
  .strict()

sonarqubeIntegrationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { sonarqubeIntegrations: 1 } },
  )

  return c.json({ integrations: (doc?.sonarqubeIntegrations ?? []).map(sonarqubePublicView) })
})

sonarqubeIntegrationsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', bindSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const { label, token } = c.req.valid('json')
    const baseUrl = c.req.valid('json').baseUrl.replace(/\/$/, '')
    const discovered = await verifySonarqubeCredentials({ baseUrl, token }).catch(
      (err: unknown) => {
        throw mapSonarqubeError(err)
      },
    )
    const now = new Date()
    const binding: SonarqubeIntegrationBinding = {
      id: new ObjectId(),
      label,
      baseUrl,
      encryptedToken: encryptSonarqubeSecret(token),
      version: discovered.version,
      createdAt: now,
      access: createDefaultAccess(c.get('userId'), now),
    }
    // `$push` owns sonarqubeIntegrations in this update, so initialize every
    // other binding collection without writing the same path twice.
    const { sonarqubeIntegrations: _sonarqubeIntegrations, ...insertDefaults } =
      emptyTeamByosBindings()

    await teamByosBindings().updateOne(
      { _id: teamId },
      {
        $push: { sonarqubeIntegrations: binding },
        $set: { updatedAt: now },
        $setOnInsert: insertDefaults,
      },
      { upsert: true },
    )

    return c.json(sonarqubePublicView(binding), 201)
  },
)

const scoped = new Hono<{ Variables: SonarqubeIntegrationVariables }>()

scoped.use('*', requireSonarqubeIntegration())

registerSonarqubeScopedRoutes(scoped)

sonarqubeIntegrationsRoutes.route('/:integrationId', scoped)
