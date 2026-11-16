import { createHash, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { initialBindingAccess } from '@/lib/byos/initial-access'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { connectorOAuthReady } from '@/models'

import type { BindingAccess, BindingShareChoice, ConnectorOAuthReady } from '@/models'
import type { ObjectId } from 'mongodb'

/**
 * Writes a staged binding draft into the team and returns the deep-link params.
 * `access` is the member list a new binding starts with; a rebind keeps its own.
 */
export type ConnectorBindPersist<B> = (
  teamId: ObjectId,
  draft: B,
  access: BindingAccess,
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
  defer?: boolean
  state: string
  teamId: ObjectId
  requesterUserId: string
  /** What the requester chose when starting the flow. */
  share?: BindingShareChoice
  highPrivilege?: boolean
  draft: B
  persist: ConnectorBindPersist<B>
}): Promise<Record<string, string>> {
  const membership = await getTeamMembership(input.requesterUserId, input.teamId.toHexString())
  const access = initialBindingAccess({
    userId: input.requesterUserId,
    team: membership?.team,
    share: input.share,
    highPrivilege: input.highPrivilege,
  })

  if (!(input.defer ?? config.byos.connectorOAuthDeferredBind)) {
    return { state: input.state, ...(await input.persist(input.teamId, input.draft, access)) }
  }
  const code = randomBytes(24).toString('base64url')

  await connectorOAuthReady().insertOne({
    _id: input.state,
    codeHash: sha256(code),
    provider: input.provider,
    teamId: input.teamId,
    requesterUserId: input.requesterUserId,
    binding: input.draft as Record<string, unknown>,
    access,
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
  /** Narrows which grants this caller may take, e.g. by the role they hold now. */
  scope?: Record<string, unknown>
}): Promise<ConnectorOAuthReady> {
  const ready = await connectorOAuthReady().findOneAndDelete({
    ...input.scope,
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
