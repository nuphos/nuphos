import { ObjectId } from 'mongodb'

import { invalidateCloudflareAccessToken } from '@/lib/byos/cloudflare-oauth'
import { appendEnvironmentBinding } from '@/lib/byos/environment-bindings'
import { assertMayRebind } from '@/lib/connector-oauth'
import { AppError } from '@/lib/errors'
import { cloudflareOAuthResult, teamByosBindings } from '@/models'

import type { BindingAccess, CloudflareAccountBinding } from '@/models'

export type CloudflareBindingDraft = Pick<CloudflareAccountBinding, 'accountId' | 'accountName'> & {
  // Keys the Desktop polling result (`/result/:state` in cloudflare-app.ts).
  state: string
  oauth: NonNullable<CloudflareAccountBinding['oauth']>
}

// Re-binding the same account replaces its credentials (preserving the id)
// instead of accumulating duplicates. Keyed by accountId and done with
// conditional writes so two concurrent callbacks for the same account can't
// both observe "no existing binding" and each $push a duplicate.
export async function persistCloudflareBinding(
  teamId: ObjectId,
  draft: CloudflareBindingDraft,
  access: BindingAccess,
): Promise<Record<string, string>> {
  const now = new Date()
  const { state, accountId, accountName, oauth: oauthEnvelope } = draft

  const entryForAccount = async () =>
    (
      await teamByosBindings().findOne(
        { _id: teamId, 'cloudflareAccounts.accountId': accountId },
        { projection: { 'cloudflareAccounts.$': 1 } },
      )
    )?.cloudflareAccounts?.[0]
  // Replace an existing entry for this account in place, only while its list
  // is the one the rebind was allowed against. The positional `$` only touches
  // the OAuth fields, so a previously-bound account's R2 S3 credentials and
  // createdAt are preserved; $unset drops a legacy API key when converting an
  // api_token binding to OAuth. Null when the account has no entry.
  const rebindInPlace = async (): Promise<ObjectId | null> => {
    const existing = await entryForAccount()

    if (!existing) return null
    assertMayRebind(existing, access)
    const result = await teamByosBindings().updateOne(
      {
        _id: teamId,
        cloudflareAccounts: {
          $elemMatch: { id: existing.id, 'access.updatedAt': existing.access?.updatedAt ?? null },
        },
      },
      {
        $set: {
          'cloudflareAccounts.$.accountName': accountName,
          'cloudflareAccounts.$.authType': 'oauth',
          'cloudflareAccounts.$.oauth': oauthEnvelope,
          updatedAt: now,
        },
        $unset: { 'cloudflareAccounts.$.encryptedApiKey': '' },
      },
    )

    if (result.matchedCount === 0) {
      throw new AppError(
        409,
        'binding_access_changed',
        'Who may use this Cloudflare account changed while it was being connected. Try again.',
      )
    }

    return existing.id
  }

  let bindingId = await rebindInPlace()

  if (!bindingId) {
    bindingId = new ObjectId()
    const newBinding: CloudflareAccountBinding = {
      id: bindingId,
      accountId,
      accountName,
      authType: 'oauth',
      oauth: oauthEnvelope,
      createdAt: now,
      access,
    }
    const inserted = await appendEnvironmentBinding(
      teamId,
      { 'cloudflareAccounts.accountId': { $ne: accountId } },
      { $push: { cloudflareAccounts: newBinding }, $set: { updatedAt: now } },
    )

    // Another flow connected the same account while OAuth was in progress.
    // Refresh that binding in place, by the same rule, rather than consuming another slot.
    if (!inserted) {
      bindingId = await rebindInPlace()
      if (!bindingId) {
        throw new AppError(
          409,
          'cloudflare_account_already_bound',
          'Cloudflare account is already bound',
        )
      }
    }
  }

  // bindingId is preserved across re-binds, and getCloudflareOAuthAccessToken
  // caches by teamId:bindingId — drop the stale entry so the new token/scopes
  // take effect immediately.
  invalidateCloudflareAccessToken(teamId, bindingId)

  // Record the result keyed by `state` so the desktop can finish the bind by
  // polling even if the nuphos:// deep link below is captured by another app.
  await cloudflareOAuthResult().replaceOne(
    { _id: state },
    {
      teamId,
      bindingId,
      accountId,
      accountName,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    },
    { upsert: true },
  )

  return {
    binding_id: bindingId.toHexString(),
    team_id: teamId.toHexString(),
    account_id: accountId,
    account_name: accountName ?? '',
  }
}
