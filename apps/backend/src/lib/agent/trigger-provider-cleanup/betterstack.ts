import {
  BetterStackApiError,
  deleteBetterStackOutgoingWebhook,
  getBetterStackOutgoingWebhook,
} from '@/lib/byos/betterstack'
import { decryptBetterStackToken } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import { cleanupConflict, targetsManagedWebhook } from './shared'

import type { BetterStackProviderWiring } from '../trigger-provider-wiring'
import type { ObjectId } from 'mongodb'

export async function cleanupBetterStack(
  teamId: ObjectId,
  triggerId: string,
  receipt: BetterStackProviderWiring,
): Promise<void> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { betterStackIntegrations: 1 } },
  )
  const binding = (doc?.betterStackIntegrations ?? []).find(
    (item) => item.id.toHexString() === receipt.integrationId,
  )

  if (!binding?.encryptedUptimeApiToken) {
    cleanupConflict('The Better Stack integration used by this Watch is no longer connected')
  }
  const handle = { uptimeApiToken: decryptBetterStackToken(binding.encryptedUptimeApiToken) }
  let outgoingWebhook

  try {
    outgoingWebhook = await getBetterStackOutgoingWebhook(handle, receipt.outgoingWebhookId)
  } catch (err) {
    if (err instanceof BetterStackApiError && err.status === 404) return
    throw err
  }
  if (!targetsManagedWebhook(outgoingWebhook.url, triggerId)) {
    cleanupConflict('The Better Stack outgoing webhook no longer belongs to this Watch')
  }
  try {
    await deleteBetterStackOutgoingWebhook(handle, receipt.outgoingWebhookId)
  } catch (err) {
    // A concurrent/manual deletion between the read and delete is already the
    // desired final state. Keep cleanup retry-safe.
    if (err instanceof BetterStackApiError && err.status === 404) return
    throw err
  }
  try {
    await getBetterStackOutgoingWebhook(handle, receipt.outgoingWebhookId)
  } catch (err) {
    if (err instanceof BetterStackApiError && err.status === 404) return
    throw err
  }
  throw new AppError(
    502,
    'provider_cleanup_verification_failed',
    'Better Stack outgoing webhook still exists after deletion',
  )
}
