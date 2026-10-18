import { createHash, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { connectorOAuthReady } from '@/models'

import type { ConnectorOAuthReady } from '@/models'
import type { ObjectId } from 'mongodb'

/** Writes a staged binding draft into the team and returns the deep-link params. */
export type ConnectorBindPersist<B> = (
  teamId: ObjectId,
  draft: B,
) => Promise<Record<string, string>>

const READY_TTL_MS = 10 * 60_000

/**
 * The browser callback's last step. Binding straight away trusts whoever
 * approved at the provider. Staging hands a one-time completion code only to
 * the client the provider redirected (the approver's), and complete-oauth needs
 * both that code and the requester's session: an authorize link someone else
 * approved never reaches the requester's client, so it binds nothing.
 */
export async function finishConnectorOAuth<B extends object>(input: {
  provider: string
  state: string
  teamId: ObjectId
  requesterUserId: string
  draft: B
  persist: ConnectorBindPersist<B>
}): Promise<Record<string, string>> {
  if (!config.byos.connectorOAuthDeferredBind) {
    return { state: input.state, ...(await input.persist(input.teamId, input.draft)) }
  }
  const code = randomBytes(24).toString('base64url')

  await connectorOAuthReady().insertOne({
    _id: input.state,
    codeHash: sha256(code),
    provider: input.provider,
    teamId: input.teamId,
    requesterUserId: input.requesterUserId,
    binding: input.draft as Record<string, unknown>,
    expiresAt: new Date(Date.now() + READY_TTL_MS),
  })

  return { state: input.state, deferred: '1', code }
}

/** Takes a staged grant: needs the callback's code and the team and user that started it. */
export async function claimConnectorOAuth(input: {
  state: string
  code: string
  teamId: ObjectId
  userId: string
}): Promise<ConnectorOAuthReady> {
  const ready = await connectorOAuthReady().findOneAndDelete({
    _id: input.state,
    codeHash: sha256(input.code),
    teamId: input.teamId,
    requesterUserId: input.userId,
    expiresAt: { $gt: new Date() },
  })

  if (!ready) {
    throw new AppError(404, 'oauth_not_ready', 'No approved connection is waiting for this request')
  }

  return ready
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
