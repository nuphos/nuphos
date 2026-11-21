// The agent's GitHub and Linear handouts call personalGithubToken /
// personalLinearToken with the turn's sender and fall back to the team token
// when they return null. Gmail and Google Drive have no team token: their
// handout returns personalGoogleToken or nothing. Refreshes rotate the stored
// grant in place.
import { credentialSource, getConversationBySessionId } from '@/lib/agent/db'
import { getDefaultClientCredentials } from '@/lib/byos/linear'
import { refreshTokens } from '@/lib/byos/linear-oauth'
import {
  personalCredentialSubject,
  verifyPreviewMcpToken,
} from '@/lib/claude-code-preview/mcp-token'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { personalCredentials } from '@/models'

import { githubUserInstallationIds, refreshGithubToken } from './github'
import { isGoogleProvider, refreshGoogleToken, teamGoogleClient } from './google'
import { open, seal } from './seal'

import type { ProviderTokens } from './github'
import type { GoogleProvider } from './google'
import type { PersonalCredential } from '@/models'

export type PersonalToken = { token: string; expiresAt: Date | null; login: string }

const refreshing = new Map<string, Promise<PersonalToken | null>>()

function stillFresh(expiresAt: Date | null): boolean {
  return expiresAt === null || expiresAt.getTime() - 5 * 60_000 > Date.now()
}

/**
 * The provider's token endpoint refused the grant (e.g. Google `invalid_grant`,
 * a revoked token), as opposed to a network error, a 5xx, or a rate limit.
 */
function refused(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status

  return typeof status === 'number' && status >= 400 && status < 500 && ![408, 429].includes(status)
}

async function refresh(doc: PersonalCredential): Promise<PersonalToken | null> {
  if (!doc.encryptedRefreshToken) return null
  const refreshToken = open(doc.provider, doc.encryptedRefreshToken)
  let tokens: ProviderTokens

  try {
    if (doc.provider === 'github') {
      tokens = await refreshGithubToken(refreshToken)
    } else if (isGoogleProvider(doc.provider)) {
      const client = doc.teamId ? await teamGoogleClient(doc.teamId) : null

      // Without the team's client there is nothing to refresh with yet.
      if (!client) return null
      tokens = await refreshGoogleToken(client, refreshToken)
    } else {
      const client = getDefaultClientCredentials()

      if (!client) return null
      tokens = await refreshTokens(client.clientId, client.clientSecret, refreshToken)
    }
  } catch (error) {
    // Another replica may have rotated the refresh token first.
    const latest = await personalCredentials().findOne({ _id: doc._id })

    if (
      latest?.encryptedAccessToken &&
      stillFresh(latest.accessTokenExpiresAt) &&
      latest.updatedAt > doc.updatedAt
    ) {
      return {
        token: open(latest.provider, latest.encryptedAccessToken),
        expiresAt: latest.accessTokenExpiresAt,
        login: latest.login,
      }
    }
    logError('personal_credential.refresh_failed', error, { provider: doc.provider })
    // A timeout or 5xx keeps the grant for the next try. Only a refused grant
    // (revoked or expired) is dropped, so the team token takes over.
    if (!refused(error)) return null
    await personalCredentials().deleteOne({ _id: doc._id, updatedAt: doc.updatedAt })

    return null
  }
  await personalCredentials().updateOne(
    { _id: doc._id },
    {
      $set: {
        encryptedAccessToken: seal(doc.provider, tokens.accessToken),
        encryptedRefreshToken: tokens.refreshToken
          ? seal(doc.provider, tokens.refreshToken)
          : doc.encryptedRefreshToken,
        accessTokenExpiresAt: tokens.expiresAt,
        updatedAt: new Date(),
      },
    },
  )

  return { token: tokens.accessToken, expiresAt: tokens.expiresAt, login: doc.login }
}

async function currentToken(doc: PersonalCredential): Promise<PersonalToken | null> {
  // A Composio connection keeps its Google grant at Composio: there is no token to hand out.
  if (!doc.encryptedAccessToken) return null
  if (stillFresh(doc.accessTokenExpiresAt)) {
    return {
      token: open(doc.provider, doc.encryptedAccessToken),
      expiresAt: doc.accessTokenExpiresAt,
      login: doc.login,
    }
  }
  const key = doc._id.toHexString()
  const inflight = refreshing.get(key) ?? refresh(doc).finally(() => refreshing.delete(key))

  refreshing.set(key, inflight)

  return inflight
}

const installationAccess = new Map<string, number>()
const INSTALLATION_ACCESS_TTL_MS = 10 * 60 * 1000

/** The sender's GitHub token, when they connected one that can see this installation. */
export async function personalGithubToken(
  userId: string,
  installationId: number,
): Promise<PersonalToken | null> {
  const doc = await personalCredentials().findOne({ userId, provider: 'github' })
  const current = doc && (await currentToken(doc))

  if (!doc || !current) return null
  const key = `${doc._id.toHexString()}:${String(installationId)}`

  if ((installationAccess.get(key) ?? 0) > Date.now()) return current
  const visible = await githubUserInstallationIds(current.token).catch(
    (error: unknown): number[] => {
      logError('personal_credential.installations_failed', error, { provider: 'github' })

      return []
    },
  )

  if (!visible.includes(installationId)) return null
  installationAccess.set(key, Date.now() + INSTALLATION_ACCESS_TTL_MS)

  return current
}

/** The member's own GitHub or Linear token, for a conversation with no team binding to go through. */
export async function personalOwnToken(
  userId: string,
  provider: 'github' | 'linear',
): Promise<PersonalToken | null> {
  const doc = await personalCredentials().findOne({ userId, provider })

  return doc ? currentToken(doc) : null
}

/**
 * The member's own Personal Credentials, as the selector offers them. A Google
 * grant belongs to the team whose client issued it, so only that team offers it.
 */
export async function ownPersonalCredentialOptions(userId: string, teamId: string) {
  const docs = await personalCredentials()
    .find({ userId }, { projection: { provider: 1, login: 1, teamId: 1 } })
    .toArray()

  return docs
    .filter((doc) => !doc.teamId || doc.teamId === teamId)
    .map((doc) => ({ id: doc._id.toHexString(), provider: doc.provider, login: doc.login }))
}

/** The sender's Linear token, when they connected the same workspace as this binding. */
export async function personalLinearToken(
  userId: string,
  workspaceId: string,
): Promise<PersonalToken | null> {
  const doc = await personalCredentials().findOne({ userId, provider: 'linear', workspaceId })

  return doc ? currentToken(doc) : null
}

/**
 * The member's Google account for one call: the one named by `connectionId`, or the only one
 * connected through this team. Several and none named is an error that lists them: nothing is
 * picked for the caller, and only the member's own accounts are ever considered.
 */
export async function googleCredentialFor(
  userId: string,
  provider: GoogleProvider,
  teamId: string,
  connectionId?: string,
  authorized?: string[],
  viaComposio = false,
): Promise<PersonalCredential | null> {
  // Composio runs only the accounts connected through it, so a direct account never counts there.
  const docs = await personalCredentials()
    .find({
      userId,
      provider,
      teamId,
      ...(viaComposio && { composioAccountId: { $exists: true } }),
    })
    .toArray()
  // The conversation's own list decides. Without one, only a lone account is usable, so a second
  // account connected later is never reached by a selection made before it existed.
  const allowed = authorized
    ? docs.filter((doc) => authorized.includes(doc._id.toHexString()))
    : docs.length === 1
      ? docs
      : []
  const notAuthorized = () =>
    new AppError(
      403,
      'personal_credential_account_not_authorized',
      'This account is not authorized for this conversation: the owner selects which accounts it may use',
    )

  if (connectionId) {
    const named = docs.find((doc) => doc._id.toHexString() === connectionId)

    if (!named) {
      throw new AppError(
        404,
        'personal_credential_account_not_found',
        'No such connected account for this member',
      )
    }
    if (!allowed.includes(named)) throw notAuthorized()

    return named
  }
  if (allowed.length > 1) {
    throw new AppError(
      409,
      'personal_credential_account_required',
      'Several accounts are authorized: ask which one to use, then name it with connectionId',
      { accounts: allowed.map((doc) => ({ id: doc._id.toHexString(), login: doc.login })) },
    )
  }
  if (allowed.length === 0 && docs.length > 0) throw notAuthorized()

  return allowed[0] ?? null
}

/** The token of an already resolved Google account. */
export const personalGoogleTokenOf = currentToken

/** The member's own Gmail or Google Drive token, when they connected it through this team. */
export async function personalGoogleToken(
  userId: string,
  provider: GoogleProvider,
  teamId: string,
  connectionId?: string,
): Promise<PersonalToken | null> {
  const doc = await googleCredentialFor(userId, provider, teamId, connectionId)

  return doc ? currentToken(doc) : null
}

/**
 * The member whose Personal Credential this handout uses, or null for the team
 * identity: the agent asked for it (`identity=team`), or the conversation's
 * credential selection has the team act for this provider.
 */
export async function personalCredentialSubjectFor(
  provider: 'github' | 'linear',
  authorization: string | undefined,
  identity?: string,
): Promise<string | null> {
  const subject = personalCredentialSubject(authorization, identity)
  const sessionId = subject
    ? verifyPreviewMcpToken(authorization!.slice('Bearer '.length))?.sid
    : null

  if (!subject || !sessionId) return null
  const found = await getConversationBySessionId(sessionId)
  const conversation = found && (await credentialSource(found))

  return conversation?.credentialAccess?.teamIdentity?.includes(provider) ? null : subject
}
