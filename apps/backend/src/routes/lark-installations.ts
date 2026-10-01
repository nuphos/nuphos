import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { encryptLarkSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { deleteLarkTeamBridgeState } from '@/lib/lark/agent-bot'
import { verifyLarkCredentials } from '@/lib/lark/api'
import {
  assertLarkAppAvailable,
  getLarkBindingForTeam,
  publicLarkInstallationView,
} from '@/lib/lark/installations'
import { parseObjectId } from '@/lib/objectid'
import { requireTeamRole } from '@/middleware/auth'
import { teamByosBindings } from '@/models'

import type { LarkDomain } from '@/lib/lark/api'
import type { TeamAuthVariables } from '@/middleware/auth'
import type { LarkAppBinding } from '@/models'

export const larkInstallationsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Feishu app_id looks like cli_xxxxxxxxxxxxxxxx.
const APP_ID_RE = /^cli_[a-z0-9]+$/i

// Lark's Event Request URL is called by Feishu's own servers, so it must always
// be the public production endpoint — never a dev/local publicBaseUrl, which
// would be an unreachable localhost. Hard-pinned regardless of environment.
const LARK_WEBHOOK_BASE_URL = 'https://api.nuphos.ai'

function webhookUrlFor(appId: string): string {
  return `${LARK_WEBHOOK_BASE_URL}/lark/events/${appId}`
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

larkInstallationsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = await getLarkBindingForTeam(teamId)

  return c.json({
    installation: binding ? publicLarkInstallationView(binding) : null,
    webhookUrl: binding ? webhookUrlFor(binding.appId) : null,
  })
})

// Connect (or replace) this team's Feishu custom app by submitting its
// credentials. There is no OAuth: the team creates its own 企业自建应用 and pastes
// app_id / app_secret / Encrypt Key here.
larkInstallationsRoutes.put('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  const appId = trimmedString(body.appId)
  const appSecret = trimmedString(body.appSecret)
  const encryptKey = trimmedString(body.encryptKey)
  const domain: LarkDomain = body.domain === 'larksuite' ? 'larksuite' : 'feishu'

  if (!APP_ID_RE.test(appId)) {
    throw new AppError(400, 'invalid_request', 'A valid Feishu app_id (cli_…) is required')
  }
  if (!appSecret) throw new AppError(400, 'invalid_request', 'app_secret is required')
  if (!encryptKey) {
    throw new AppError(
      400,
      'invalid_request',
      'The event Encrypt Key is required (Nuphos fails closed without it)',
    )
  }

  // Reject an app already bound to a different Nuphos team before we spend a
  // round-trip verifying credentials.
  await assertLarkAppAvailable(appId, teamId)

  // Prove the credentials before storing them (mints a tenant_access_token).
  await verifyLarkCredentials({ appId, appSecret, domain })

  const binding: LarkAppBinding = {
    id: new ObjectId(),
    appId,
    encryptedAppSecret: encryptLarkSecret(appSecret),
    encryptedEncryptKey: encryptLarkSecret(encryptKey),
    domain,
    createdAt: new Date(),
  }

  // Switching to a different app id invalidates the old app's mappings/threads.
  const existing = await getLarkBindingForTeam(teamId)

  if (existing && existing.appId !== appId) {
    await deleteLarkTeamBridgeState(teamId.toHexString())
  }

  // Custom-app model is one app per team: replace the array wholesale.
  await teamByosBindings().updateOne(
    { _id: teamId },
    {
      $set: { larkApps: [binding], updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  )

  return c.json({
    installation: publicLarkInstallationView(binding),
    webhookUrl: webhookUrlFor(appId),
  })
})

larkInstallationsRoutes.delete('/', requireTeamRole('ADMINISTRATOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')

  await teamByosBindings().updateOne(
    { _id: teamId },
    { $set: { larkApps: [], updatedAt: new Date() } },
  )
  // Drop the bridge records (mappings + threads) so a reconnect never reuses a
  // session frozen on the old team/user.
  await deleteLarkTeamBridgeState(teamId.toHexString())

  return c.body(null, 204)
})

larkInstallationsRoutes.get('/status', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const binding = await getLarkBindingForTeam(teamId)

  return c.json({
    installed: !!binding,
    connected: !!binding,
    ...(binding
      ? { appId: binding.appId, domain: binding.domain, webhookUrl: webhookUrlFor(binding.appId) }
      : {}),
  })
})
