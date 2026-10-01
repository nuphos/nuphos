import { getCloudflareOAuthAccessToken } from '@/lib/byos/cloudflare-oauth'
import { decryptCloudflareApiKey } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'

import type { CloudflareAccountHandle } from '@/lib/byos/cloudflare'
import type { CloudflareAccountBinding } from '@/models'
import type { ObjectId } from 'mongodb'

/**
 * Resolve a Cloudflare API handle from the current team binding. The returned
 * token is deliberately request-local and must never be persisted or returned
 * to a client.
 */
export async function cloudflareAccountHandle(
  teamId: ObjectId,
  binding: CloudflareAccountBinding,
): Promise<CloudflareAccountHandle> {
  if (binding.oauth) {
    return {
      accountId: binding.accountId,
      apiKey: await getCloudflareOAuthAccessToken(teamId, binding),
    }
  }
  if (!binding.encryptedApiKey) {
    throw new AppError(500, 'cloudflare_no_credentials', 'Cloudflare binding has no credentials')
  }

  return {
    accountId: binding.accountId,
    apiKey: decryptCloudflareApiKey(binding.encryptedApiKey),
  }
}
