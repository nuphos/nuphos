import crypto from 'node:crypto'

import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { findCloudflareAccount } from '@/lib/byos/account'
import { verifyCloudflareAccount } from '@/lib/byos/cloudflare'
import {
  isCloudflareOAuthConfigured,
  getCloudflareOAuthClient,
  getCloudflareOAuthSetupRedirect,
  resolveCloudflareScopeParam,
  buildCloudflareAuthorizeUrl,
} from '@/lib/byos/cloudflare-oauth'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { encryptCloudflareApiKey } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings, cloudflarePendingOAuth } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { CloudflareAccountBinding } from '@/models'
import type { Hono } from 'hono'

const accountIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{32}$/i, 'accountId must be a 32-character Cloudflare account ID')
  .transform((v) => v.toLowerCase())

const bindSchema = z
  .object({
    accountId: accountIdSchema,
    apiKey: z.string().trim().min(1),
  })
  .strict()

export function publicView(binding: CloudflareAccountBinding) {
  return {
    id: binding.id.toHexString(),
    accountId: binding.accountId,
    accountName: binding.accountName,
    authType: binding.oauth ? ('oauth' as const) : ('api_token' as const),
    createdAt: binding.createdAt,
  }
}

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000

const startOAuthSchema = z
  .object({
    // Scope strings selected by the user in the connect dialog. Falls back to
    // the server default when omitted; offline_access is always added.
    scopes: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[a-z0-9_.:-]+$/i)
          .max(64),
      )
      .max(64)
      .optional(),
  })
  .strict()

export function registerCloudflareBindRoutes(routes: Hono<{ Variables: TeamAuthVariables }>): void {
  routes.get('/', async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const doc = await teamByosBindings().findOne(
      { _id: teamId },
      { projection: { cloudflareAccounts: 1 } },
    )

    return c.json({
      accounts: (doc?.cloudflareAccounts ?? []).map(publicView),
    })
  })

  routes.post('/', requireTeamRole('ADMINISTRATOR'), zv('json', bindSchema), async (c) => {
    const { accountId, apiKey } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    const existing = await findCloudflareAccount(teamId, accountId)

    if (existing) {
      throw new AppError(
        409,
        'cloudflare_account_already_bound',
        `Cloudflare account ${accountId} is already bound`,
      )
    }
    // After the duplicate check (re-binding a known account adds no
    // environment) but before the credential round trips.

    let verified

    try {
      verified = await verifyCloudflareAccount({
        accountId,
        apiKey,
      })
    } catch (e) {
      throw new AppError(
        400,
        'invalid_cloudflare_credentials',
        e instanceof Error ? e.message : 'Cloudflare credentials could not be verified',
      )
    }
    if (verified.accountId.toLowerCase() !== accountId) {
      throw new AppError(
        400,
        'cloudflare_account_mismatch',
        `Cloudflare returned account ${verified.accountId}, expected ${accountId}`,
      )
    }

    const binding: CloudflareAccountBinding = {
      id: new ObjectId(),
      accountId,
      accountName: verified.accountName,
      authType: 'api_token',
      encryptedApiKey: encryptCloudflareApiKey(apiKey),
      createdAt: new Date(),
    }

    const inserted = await appendEnvironmentBinding(
      teamId,
      { 'cloudflareAccounts.accountId': { $ne: accountId } },
      {
        $push: { cloudflareAccounts: binding },
        $set: { updatedAt: binding.createdAt },
      },
    )

    if (!inserted) {
      throw new AppError(
        409,
        'cloudflare_account_already_bound',
        `Cloudflare account ${accountId} is already bound`,
      )
    }

    return c.json(publicView(binding), 201)
  })

  // Begin the "Connect with Cloudflare" OAuth flow. Returns an authorize URL the
  // desktop opens in a browser; Cloudflare redirects back to /cloudflare-app/setup
  // which finishes the bind and deep-links to the desktop.
  routes.post(
    '/start-oauth',
    requireTeamRole('ADMINISTRATOR'),
    zv('json', startOAuthSchema),
    async (c) => {
      if (!isCloudflareOAuthConfigured()) {
        throw new AppError(
          503,
          'cloudflare_oauth_not_configured',
          'Cloudflare OAuth is not configured on the server (set CLOUDFLARE_OAUTH_CLIENT_ID/SECRET/SETUP_REDIRECT)',
        )
      }
      const client = getCloudflareOAuthClient()!
      const redirectUri = getCloudflareOAuthSetupRedirect()!
      const teamId = parseObjectId(c.get('teamId'), 'teamId')
      const requesterUserId = c.get('userId')
      const { scopes } = c.req.valid('json')

      // The OAuth bind lands in the cloudflare-app callback, where a 402
      // would render as a browser error page. Refuse here instead, before the
      // user leaves the app. Re-binding an existing account goes through the
      // callback's in-place path and adds no environment, so this only ever
      // stops a genuinely new connection.

      const state = crypto.randomBytes(24).toString('hex')
      const expiresAt = new Date(Date.now() + OAUTH_PENDING_TTL_MS)

      await cloudflarePendingOAuth().insertOne({ _id: state, teamId, requesterUserId, expiresAt })

      const authorizeUrl = buildCloudflareAuthorizeUrl({
        clientId: client.clientId,
        redirectUri,
        state,
        scope: resolveCloudflareScopeParam(scopes),
      })

      return c.json({ authorizeUrl, state, expiresAt: expiresAt.toISOString() })
    },
  )

  // Cancel a pending grant (desktop dialog dismissed before approval). Idempotent.
  routes.delete('/start-oauth/:state', requireTeamRole('ADMINISTRATOR'), async (c) => {
    const state = c.req.param('state')

    if (!state || !/^[a-f0-9]{1,128}$/i.test(state)) {
      throw new AppError(400, 'invalid_state', 'Invalid state token')
    }
    const teamId = parseObjectId(c.get('teamId'), 'teamId')

    await cloudflarePendingOAuth().deleteOne({ _id: state, teamId })

    return c.body(null, 204)
  })
}
