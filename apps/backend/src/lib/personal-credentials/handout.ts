// The agent's two credential handouts call personalGithubToken /
// personalLinearToken with the turn's sender and fall back to the team token
// when they return null. Refreshes rotate the stored grant in place.
import { getConversationBySessionId } from '@/lib/agent/db'
import { getDefaultClientCredentials } from '@/lib/byos/linear'
import { refreshTokens } from '@/lib/byos/linear-oauth'
import {
  personalCredentialSubject,
  verifyPreviewMcpToken,
} from '@/lib/claude-code-preview/mcp-token'
import { logError } from '@/lib/observability'
import { personalCredentials } from '@/models'

import { githubUserInstallationIds, refreshGithubToken } from './github'
import { open, seal } from './seal'

import type { ProviderTokens } from './github'
import type { PersonalCredential, PersonalCredentialProvider } from '@/models'

export type PersonalToken = { token: string; expiresAt: Date | null; login: string }

const refreshing = new Map<string, Promise<PersonalToken | null>>()

function stillFresh(expiresAt: Date | null): boolean {
  return expiresAt === null || expiresAt.getTime() - 5 * 60_000 > Date.now()
}

async function refresh(doc: PersonalCredential): Promise<PersonalToken | null> {
  if (!doc.encryptedRefreshToken) return null
  const refreshToken = open(doc.provider, doc.encryptedRefreshToken)
  let tokens: ProviderTokens

  try {
    if (doc.provider === 'github') {
      tokens = await refreshGithubToken(refreshToken)
    } else {
      const client = getDefaultClientCredentials()

      if (!client) return null
      tokens = await refreshTokens(client.clientId, client.clientSecret, refreshToken)
    }
  } catch (error) {
    // Another replica may have rotated the refresh token first.
    const latest = await personalCredentials().findOne({ _id: doc._id })

    if (latest && stillFresh(latest.accessTokenExpiresAt) && latest.updatedAt > doc.updatedAt) {
      return {
        token: open(latest.provider, latest.encryptedAccessToken),
        expiresAt: latest.accessTokenExpiresAt,
        login: latest.login,
      }
    }
    // The grant is gone (revoked or expired): drop it so the team token takes over.
    logError('personal_credential.refresh_failed', error, { provider: doc.provider })
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

/** The sender's Linear token, when they connected the same workspace as this binding. */
export async function personalLinearToken(
  userId: string,
  workspaceId: string,
): Promise<PersonalToken | null> {
  const doc = await personalCredentials().findOne({ userId, provider: 'linear', workspaceId })

  return doc ? currentToken(doc) : null
}

/**
 * The member whose Personal Credential this handout uses, or null for the team
 * identity: the agent asked for it (`identity=team`), or the conversation's
 * credential selection has the team act for this provider.
 */
export async function personalCredentialSubjectFor(
  provider: PersonalCredentialProvider,
  authorization: string | undefined,
  identity?: string,
): Promise<string | null> {
  const subject = personalCredentialSubject(authorization, identity)
  const sessionId = subject
    ? verifyPreviewMcpToken(authorization!.slice('Bearer '.length))?.sid
    : null

  if (!subject || !sessionId) return null
  const conversation = await getConversationBySessionId(sessionId)

  return conversation?.credentialAccess?.teamIdentity?.includes(provider) ? null : subject
}
