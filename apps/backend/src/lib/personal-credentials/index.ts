// Personal Credentials: a member's own GitHub / Linear / Google grant. Connect,
// list and disconnect live here; the agent-facing handout is in ./handout.
import { createHash, randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { getDefaultClientCredentials, getViewer } from '@/lib/byos/linear'
import { buildAuthorizeUrl, exchangeCodeForTokens } from '@/lib/byos/linear-oauth'
import { publicBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { personalCredentialPendingOAuth, personalCredentials } from '@/models'

import { GOOGLE_PROVIDERS, googleTeamFor, isGoogleProvider } from './google'
import { pkceFlow } from './pkce'
import { revokeQuietly } from './revoke'
import { open, seal } from './seal'

import type { ProviderTokens } from './github'
import type { PersonalCredential, PersonalCredentialProvider } from '@/models'

const PENDING_TTL_MS = 10 * 60 * 1000
const LINEAR_SCOPE = 'read,write'

export const PERSONAL_CREDENTIAL_PROVIDERS = ['github', 'linear', ...GOOGLE_PROVIDERS] as const

const NAMES: Record<PersonalCredentialProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  gmail: 'Gmail',
  'google-drive': 'Google Drive',
}

/** The callback is on the backend's public origin (NUPHOS_PUBLIC_BACKEND_URL). */
function callbackUrl(provider: PersonalCredentialProvider): string | null {
  const base = publicBackendUrl()

  return base?.startsWith('https://')
    ? `${base.replace(/\/$/u, '')}/personal-credentials/${provider}/callback`
    : null
}

function notConfigured(provider: PersonalCredentialProvider): AppError {
  return new AppError(
    503,
    'personal_credential_not_configured',
    `Personal Credentials for ${NAMES[provider]} are not configured on this server`,
  )
}

export type PersonalCredentialSummary = {
  provider: PersonalCredentialProvider
  login: string
  workspaceName: string | null
  /** Gmail / Google Drive: the team whose OAuth client issued the grant. */
  teamId: string | null
  connectedAt: string
}

export async function listPersonalCredentials(
  userId: string,
): Promise<PersonalCredentialSummary[]> {
  const docs = await personalCredentials()
    .find(
      { userId },
      { projection: { provider: 1, login: 1, workspaceName: 1, teamId: 1, createdAt: 1 } },
    )
    .toArray()

  return docs.map((doc) => ({
    provider: doc.provider,
    login: doc.login,
    workspaceName: doc.workspaceName ?? null,
    teamId: doc.teamId ?? null,
    connectedAt: doc.createdAt.toISOString(),
  }))
}

export async function startPersonalCredentialOAuth(
  userId: string,
  provider: PersonalCredentialProvider,
  requestedTeamId?: string,
): Promise<{ authorizeUrl: string; state: string }> {
  const redirectUri = callbackUrl(provider)
  const state = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS)
  const teamId = isGoogleProvider(provider)
    ? await googleTeamFor(userId, requestedTeamId)
    : undefined
  const flow = await pkceFlow(provider, teamId)

  if (flow) {
    if (!flow.client || !redirectUri || !flow.key) throw notConfigured(provider)
    const verifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')

    await personalCredentialPendingOAuth().insertOne({
      _id: state,
      userId,
      provider,
      ...(teamId ? { teamId } : {}),
      encryptedCodeVerifier: seal(provider, verifier),
      expiresAt,
    })

    return {
      state,
      authorizeUrl: flow.authorizeUrl({
        clientId: flow.client.clientId,
        redirectUri,
        state,
        codeChallenge,
      }),
    }
  }
  const client = getDefaultClientCredentials()

  if (!client || !redirectUri || !config.byos.linear.encryptionKey) throw notConfigured(provider)
  await personalCredentialPendingOAuth().insertOne({ _id: state, userId, provider, expiresAt })

  return {
    state,
    authorizeUrl: buildAuthorizeUrl({
      clientId: client.clientId,
      redirectUri,
      state,
      scope: LINEAR_SCOPE,
      actor: 'user',
    }),
  }
}

type Identity = Pick<
  PersonalCredential,
  'providerUserId' | 'login' | 'workspaceId' | 'workspaceName' | 'teamId'
>

/**
 * The browser callback: exchanges the code and stages the grant. Saving it
 * straight away would trust whoever approved at the provider, so it waits for
 * claimPersonalCredential: only the approver's own app gets the one-time code,
 * and claiming also needs the session of the member who started the flow.
 */
export async function stagePersonalCredentialOAuth(
  provider: PersonalCredentialProvider,
  state: string,
  code: string,
): Promise<{ state: string; code: string }> {
  const pending = await personalCredentialPendingOAuth().findOneAndDelete({
    _id: state,
    provider,
    staged: { $exists: false },
    expiresAt: { $gt: new Date() },
  })

  if (!pending) {
    throw new AppError(
      400,
      'invalid_state',
      'This authorization request expired or was already used',
    )
  }
  const redirectUri = callbackUrl(provider)
  let tokens: ProviderTokens
  let identity: Identity

  const flow = await pkceFlow(provider, pending.teamId)

  if (flow) {
    if (!flow.client || !redirectUri || !pending.encryptedCodeVerifier) {
      throw notConfigured(provider)
    }
    tokens = await flow.exchange({
      ...flow.client,
      code,
      redirectUri,
      codeVerifier: open(provider, pending.encryptedCodeVerifier),
    })
    const user = await flow.user(tokens.accessToken)

    identity = { providerUserId: user.id, login: user.login }
    if (pending.teamId) {
      const membership = await getTeamMembership(pending.userId, pending.teamId)

      identity = { ...identity, teamId: pending.teamId, workspaceName: membership?.team.name }
    }
  } else {
    const client = getDefaultClientCredentials()

    if (!client || !redirectUri) throw notConfigured(provider)
    tokens = await exchangeCodeForTokens(client.clientId, client.clientSecret, code, redirectUri)
    const viewer = await getViewer(tokens.accessToken)

    identity = {
      providerUserId: viewer.user.id,
      login: viewer.user.name ?? viewer.user.id,
      workspaceId: viewer.organization.id,
      workspaceName: viewer.organization.name,
    }
  }
  const claimCode = randomBytes(24).toString('base64url')

  await personalCredentialPendingOAuth().insertOne({
    _id: state,
    userId: pending.userId,
    provider,
    codeHash: sha256(claimCode),
    staged: {
      ...identity,
      encryptedAccessToken: seal(provider, tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken ? seal(provider, tokens.refreshToken) : null,
      accessTokenExpiresAt: tokens.expiresAt,
    },
    expiresAt: new Date(Date.now() + PENDING_TTL_MS),
  })

  return { state, code: claimCode }
}

/** Saves a staged grant for the member who started it, given the callback's one-time code. */
export async function claimPersonalCredential(
  userId: string,
  provider: PersonalCredentialProvider,
  state: string,
  code: string,
): Promise<PersonalCredentialSummary> {
  const ready = await personalCredentialPendingOAuth().findOneAndDelete({
    _id: state,
    provider,
    userId,
    codeHash: sha256(code),
    expiresAt: { $gt: new Date() },
  })

  if (!ready?.staged) {
    throw new AppError(404, 'oauth_not_ready', 'No approved connection is waiting for this request')
  }
  const now = new Date()
  const previous = await personalCredentials().findOneAndUpdate(
    { userId, provider, ...(ready.staged.teamId ? { teamId: ready.staged.teamId } : {}) },
    {
      $set: { ...ready.staged, updatedAt: now },
      $setOnInsert: { _id: new ObjectId(), createdAt: now },
    },
    { upsert: true, returnDocument: 'before' },
  )

  // Google revokes a member's whole grant to one client, so a replaced Google
  // grant (always the same team's client) is left alone: revoking it would end the new one.
  if (previous && !isGoogleProvider(provider)) void revokeQuietly(previous)

  return {
    provider,
    login: ready.staged.login,
    workspaceName: ready.staged.workspaceName ?? null,
    teamId: ready.staged.teamId ?? null,
    connectedAt: (previous?.createdAt ?? now).toISOString(),
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export { deleteAllPersonalCredentials, deletePersonalCredential } from './revoke'
export {
  personalCredentialSubjectFor,
  personalGithubToken,
  personalGoogleToken,
  personalLinearToken,
} from './handout'
export type { PersonalToken } from './handout'
