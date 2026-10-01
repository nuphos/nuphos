import { decryptLarkSecret } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import type { LarkAppContext } from '@/lib/lark/api'
import type { LarkAppBinding } from '@/models'
import type { ObjectId } from 'mongodb'

export type ResolvedLarkApp = {
  binding: LarkAppBinding
  nuphosTeamId: string
  ctx: LarkAppContext
  encryptKey: string
}

export async function getLarkBindingForTeam(teamId: ObjectId): Promise<LarkAppBinding | null> {
  const doc = await teamByosBindings().findOne({ _id: teamId }, { projection: { larkApps: 1 } })

  return doc?.larkApps?.[0] ?? null
}

export async function getLarkBindingByAppId(
  appId: string,
): Promise<{ nuphosTeamId: ObjectId; binding: LarkAppBinding } | null> {
  const doc = await teamByosBindings().findOne(
    { 'larkApps.appId': appId },
    { projection: { larkApps: 1 } },
  )

  if (!doc) return null
  const binding = doc.larkApps?.find((entry) => entry.appId === appId)

  if (!binding) return null

  return { nuphosTeamId: doc._id, binding }
}

// Build the decrypted credential context used for every API call to this app.
export function larkAppContext(binding: LarkAppBinding): LarkAppContext {
  return {
    appId: binding.appId,
    appSecret: decryptLarkSecret(binding.encryptedAppSecret),
    domain: binding.domain,
  }
}

// Resolves an inbound event's app_id (from the request URL) to the Nuphos team
// that registered the app, with its decrypted credentials + Encrypt Key.
export async function resolveLarkApp(appId: string): Promise<ResolvedLarkApp | null> {
  const installed = await getLarkBindingByAppId(appId)

  if (!installed) return null

  return {
    binding: installed.binding,
    nuphosTeamId: installed.nuphosTeamId.toHexString(),
    ctx: larkAppContext(installed.binding),
    encryptKey: decryptLarkSecret(installed.binding.encryptedEncryptKey),
  }
}

export function publicLarkInstallationView(binding: LarkAppBinding) {
  return {
    id: binding.id.toHexString(),
    appId: binding.appId,
    domain: binding.domain,
    tenantName: binding.tenantName ?? null,
    createdAt: binding.createdAt,
  }
}

export async function assertLarkAppAvailable(appId: string, teamId: ObjectId): Promise<void> {
  const existing = await getLarkBindingByAppId(appId)

  if (existing && !existing.nuphosTeamId.equals(teamId)) {
    throw new AppError(
      409,
      'lark_app_taken',
      'This Lark app is already connected to another Nuphos team',
    )
  }
}
