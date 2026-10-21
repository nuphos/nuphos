import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { getNuphosUserForCredential } from '@/lib/identity'
import { generateOpaqueToken, hashToken } from '@/lib/oauth/tokens'

import type { NuphosUser } from '@/lib/identity/types'

/**
 * Stored bearer tokens for terminals and bots, unlike the stateless session
 * JWT, so each can be listed and revoked on its own.
 *
 *   - `personal`: a terminal signed in as its user (device login, "as me").
 *     Full user rights, except minting agent tokens and approving device
 *     codes, so a leaked terminal token cannot spread itself.
 *   - `agent`: a named bot acting for its user inside one team. Its messages
 *     are attributed to the bot "via" the user, and it cannot manage tokens,
 *     the account, team membership, or billing (see `cliTokenDenied`).
 *
 * Only the SHA-256 of the secret is stored. A password reset revokes these
 * too, as it does session tokens (`getNuphosUserForCredential`).
 */
export const CLI_TOKEN_PREFIX = 'nup_'

export type CliTokenKind = 'personal' | 'agent'

export type CliTokenDoc = {
  _id: ObjectId
  secretHash: string
  kind: CliTokenKind
  userId: string
  /** Agent tokens only: the one team they may reach. */
  teamId?: string
  name: string
  avatarUrl?: string
  createdAt: Date
  lastUsedAt?: Date
  createdIp?: string
}

/** What a request authenticated with a CLI token carries. */
export type CliTokenPrincipal = {
  id: string
  kind: CliTokenKind
  name: string
  teamId?: string
  avatarUrl?: string
}

export const cliTokens = () => db().collection<CliTokenDoc>('cli_tokens')

export async function setupCliTokenIndexes(): Promise<void> {
  await Promise.all([
    cliTokens().createIndex({ secretHash: 1 }, { unique: true, name: 'cli_tokens_secret' }),
    cliTokens().createIndex({ userId: 1, createdAt: -1 }, { name: 'cli_tokens_user' }),
  ])
}

const LAST_USED_RESOLUTION_MS = 60_000

export function isCliToken(token: string): boolean {
  return token.startsWith(CLI_TOKEN_PREFIX)
}

export async function mintCliToken(input: {
  kind: CliTokenKind
  userId: string
  teamId?: string
  name: string
  avatarUrl?: string
  createdIp?: string
}): Promise<{ token: string; principal: CliTokenPrincipal }> {
  if (input.kind === 'agent' && !input.teamId) {
    throw new AppError(400, 'invalid_request', 'An agent token needs a team')
  }
  const token = `${CLI_TOKEN_PREFIX}${generateOpaqueToken()}`
  const doc: CliTokenDoc = {
    _id: new ObjectId(),
    secretHash: hashToken(token),
    kind: input.kind,
    userId: input.userId,
    ...(input.kind === 'agent' ? { teamId: input.teamId } : {}),
    name: input.name,
    ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
    createdAt: new Date(),
    ...(input.createdIp ? { createdIp: input.createdIp } : {}),
  }

  await cliTokens().insertOne(doc)

  return { token, principal: toPrincipal(doc) }
}

export async function authenticateCliToken(
  token: string,
): Promise<{ user: NuphosUser; cliToken: CliTokenPrincipal } | null> {
  const doc = await cliTokens().findOne({ secretHash: hashToken(token) })

  if (!doc) return null
  const user = await getNuphosUserForCredential(doc.userId, doc.createdAt)

  if (!user) return null
  const now = new Date()

  if (!doc.lastUsedAt || now.getTime() - doc.lastUsedAt.getTime() >= LAST_USED_RESOLUTION_MS) {
    // Best effort: a missed write only makes "last used" a minute staler.
    void cliTokens()
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: now } })
      .catch(() => {})
  }

  return { user, cliToken: toPrincipal(doc) }
}

export async function listCliTokens(userId: string) {
  const docs = await cliTokens().find({ userId }).sort({ createdAt: -1 }).limit(200).toArray()

  return docs.map((doc) => ({
    ...toPrincipal(doc),
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
  }))
}

export async function revokeCliToken(userId: string, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const { deletedCount } = await cliTokens().deleteOne({ _id: new ObjectId(id), userId })

  return deletedCount === 1
}

function toPrincipal(doc: CliTokenDoc): CliTokenPrincipal {
  return {
    id: doc._id.toHexString(),
    kind: doc.kind,
    name: doc.name,
    ...(doc.teamId ? { teamId: doc.teamId } : {}),
    ...(doc.avatarUrl ? { avatarUrl: doc.avatarUrl } : {}),
  }
}

/**
 * Both kinds: minting credentials takes a real sign-in, so a leaked CLI token
 * cannot outlive its own revocation. That covers tokens, device-code approval
 * and device join tokens (redeemed into an independent device credential).
 */
const SESSION_ONLY: [RegExp, RegExp][] = [
  [/^POST$/, /^\/auth\/cli-tokens\/?$/],
  [/./, /^\/auth\/device\/approve\/?$/],
  [/^POST$/, /^\/agent\/devices\/join-tokens\/?$/],
]

/**
 * Agent tokens act as their user inside one team, but never on the user's
 * account, their tokens, their computers, team membership or billing. Other
 * teams are refused by `token-team-scope`, not here.
 */
const AGENT_DENIED: [RegExp, RegExp][] = [
  [/./, /^\/auth\/cli-tokens(\/|$)/],
  [/./, /^\/auth\/account-deletion/],
  [/^(PUT|PATCH|DELETE)$/, /^\/auth\/(me|ai-consent)(\/|$)/],
  [/./, /^\/push\//],
  [/./, /^\/agent\/devices(\/|$)/],
  [/./, /^\/invitations(\/|$)/],
  [/./, /^\/personal-credentials(\/|$)/],
  [/^POST$/, /^\/teams\/?$/],
  [/^POST$/, /^\/teams\/discoverable\//],
  [/^(PUT|PATCH|DELETE)$/, /^\/teams\/[^/]+\/?$/],
  [/^(PUT|PATCH|DELETE)$/, /^\/teams\/[^/]+\/(agent-runtime|allowed-email-domains)\/?$/],
  [/^(POST|PUT|PATCH|DELETE)$/, /^\/teams\/[^/]+\/(members|invitations)(\/|$)/],
  [/./, /^\/teams\/[^/]+\/(leave|billing|transfer-ownership)(\/|$)/],
]

/** Why this CLI token may not make this request, or null when it may. */
export function cliTokenDenied(
  cliToken: Pick<CliTokenPrincipal, 'kind'>,
  method: string,
  path: string,
): string | null {
  const hit = (rules: [RegExp, RegExp][]) => rules.some(([m, p]) => m.test(method) && p.test(path))

  if (hit(SESSION_ONLY)) return 'Sign in on nuphos.ai to do this; a CLI token cannot.'
  if (cliToken.kind === 'agent' && hit(AGENT_DENIED)) {
    return 'An agent token cannot manage the account, its tokens, computers, team membership or billing.'
  }

  return null
}
