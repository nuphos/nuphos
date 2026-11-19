import { Hono } from 'hono'
import { z } from 'zod'

import { config } from '@/config'
import { encryptLinearSecret } from '@/lib/byos/secrets'
import { parseObjectId } from '@/lib/objectid'
import { GOOGLE_PROVIDERS } from '@/lib/personal-credentials/google'
import { revokeQuietly } from '@/lib/personal-credentials/revoke'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { personalCredentials, teamByosBindings } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'

// The team's own Google OAuth client, which its members' Gmail and Google
// Drive Personal Credentials connect and refresh through. Members can see
// whether one is set; only admins change it, and the secret is never returned.
// Refresh tokens belong to the client that issued them, so members' grants
// end with the client: revoked at Google first, then forgotten here, so no
// stored token outlives the client it could never be refreshed through.
async function clearTeamGrants(teamId: string): Promise<void> {
  const docs = await personalCredentials()
    .find({ teamId, provider: { $in: [...GOOGLE_PROVIDERS] } })
    .toArray()
  const revoked = new Set<string>()

  // One Google revoke ends the member's whole grant to the client, covering
  // both providers, so each member is revoked once rather than twice.
  for (const doc of docs) {
    if (revoked.has(doc.userId)) continue
    revoked.add(doc.userId)
    await revokeQuietly(doc)
  }
  // Best-effort at Google: a failed revoke is logged but must not keep a token
  // that can no longer be refreshed, and this is the only record it existed.
  await personalCredentials().deleteMany({ teamId, provider: { $in: [...GOOGLE_PROVIDERS] } })
}

export const googleOAuthClientRoutes = new Hono<{ Variables: TeamAuthVariables }>()

const clientSchema = z
  .object({
    clientId: z
      .string()
      .trim()
      .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/u, 'Expected a Google OAuth client ID'),
    clientSecret: z.string().trim().min(1).max(200),
  })
  .strict()

googleOAuthClientRoutes.get('/', async (c) => {
  const doc = await teamByosBindings().findOne(
    { _id: parseObjectId(c.get('teamId'), 'teamId') },
    { projection: { 'googleOAuthClient.clientId': 1 } },
  )

  // Without a client of its own, members can still connect through Composio when it is configured.
  return c.json({
    clientId: doc?.googleOAuthClient?.clientId ?? null,
    composio: Boolean(config.byos.composio.apiKey),
  })
})

googleOAuthClientRoutes.put(
  '/',
  requireTeamRole('ADMINISTRATOR'),
  zv('json', clientSchema),
  async (c) => {
    const { clientId, clientSecret } = c.req.valid('json')
    const teamId = c.get('teamId')
    const _id = parseObjectId(teamId, 'teamId')
    const before = await teamByosBindings().findOne(
      { _id },
      { projection: { 'googleOAuthClient.clientId': 1 } },
    )
    const now = new Date()

    // A new secret for the same client keeps the grants; a different client
    // cannot refresh them. Ended before the write, so a failure leaves the team
    // exactly as it was and saving again retries the whole change.
    if (before?.googleOAuthClient && before.googleOAuthClient.clientId !== clientId) {
      await clearTeamGrants(teamId)
    }

    await teamByosBindings().findOneAndUpdate(
      { _id },
      {
        $set: {
          googleOAuthClient: {
            clientId,
            encryptedClientSecret: encryptLinearSecret(clientSecret),
            updatedAt: now,
            updatedBy: c.get('userId'),
          },
          updatedAt: now,
        },
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

    return c.json({ clientId })
  },
)

googleOAuthClientRoutes.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = c.get('teamId')

  // Before the removal, for the same reason as a replacement.
  await clearTeamGrants(teamId)
  await teamByosBindings().updateOne(
    { _id: parseObjectId(teamId, 'teamId') },
    { $unset: { googleOAuthClient: '' } },
  )

  return c.body(null, 204)
})
