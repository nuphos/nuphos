// Personal Credentials: a member's own GitHub / Linear / Google grant. Connect,
// list and disconnect live here; the agent-facing handout is in ./handout.
import { createHash, randomBytes } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { getDefaultClientCredentials } from '@/lib/byos/linear'
import { buildAuthorizeUrl } from '@/lib/byos/linear-oauth'
import { AppError } from '@/lib/errors'
import { getTeamMembership } from '@/lib/identity'
import { personalCredentialPendingOAuth, personalCredentials } from '@/models'

import { stagedComposioConnection, startComposioConnection } from './composio'
import { callbackUrl, exchangeGrant, notConfigured } from './exchange'
import { GOOGLE_PROVIDERS, googleTeamFor, isGoogleProvider } from './google'
import { pkceFlow } from './pkce'
import { revokeQuietly } from './revoke'
import { seal } from './seal'

import type {
  PersonalCredential,
  PersonalCredentialPendingOAuth,
  PersonalCredentialProvider,
} from '@/models'

const PENDING_TTL_MS = 10 * 60 * 1000
const LINEAR_SCOPE = 'read,write'

export const PERSONAL_CREDENTIAL_PROVIDERS = ['github', 'linear', ...GOOGLE_PROVIDERS] as const

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
    ? await googleTeamFor(userId, provider, requestedTeamId)
    : undefined
  const flow = await pkceFlow(provider, teamId)

  // A team without its own Google client connects through Composio, which
  // googleTeamFor has checked is configured.
  if (isGoogleProvider(provider) && teamId && flow && !flow.client) {
    if (!redirectUri) throw notConfigured(provider)

    return startComposioConnection({ provider, userId, teamId, state, redirectUri, expiresAt })
  }
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
  const teamId = pending.teamId
  // Membership can end between starting the flow and approving it. Checked
  // before the code is exchanged, so a departed member's approval grants
  // nothing and stages nothing.
  const membership = teamId ? await getTeamMembership(pending.userId, teamId) : null

  if (teamId && !membership) {
    throw new AppError(
      403,
      'forbidden',
      'You are no longer a member of this team, so its Google credentials cannot be connected',
    )
  }
  const staged =
    pending.composioAccountId && teamId && membership && isGoogleProvider(provider)
      ? await stagedComposioConnection(
          provider,
          pending.composioAccountId,
          { userId: pending.userId, teamId },
          membership.team.name,
        )
      : await exchangeGrant(provider, pending, code, membership)
  const claimCode = randomBytes(24).toString('base64url')

  await personalCredentialPendingOAuth().insertOne({
    _id: state,
    userId: pending.userId,
    provider,
    codeHash: sha256(claimCode),
    staged,
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
  // Switching between a team-client grant and a Composio connection drops the other's fields.
  const other: Record<string, ''> = ready.staged.composioAccountId
    ? { encryptedAccessToken: '' }
    : { composioAccountId: '' }
  const previous = await personalCredentials().findOneAndUpdate(
    { userId, provider, ...(ready.staged.teamId ? { teamId: ready.staged.teamId } : {}) },
    {
      $set: { ...ready.staged, updatedAt: now },
      $unset: other,
      $setOnInsert: { _id: new ObjectId(), createdAt: now },
    },
    { upsert: true, returnDocument: 'before' },
  )

  // Google revokes a member's whole grant to one client, so a replaced Google
  // grant (always the same team's client) is left alone: revoking it would end
  // the new one. A replaced Composio connection is its own and is deleted.
  const replacedConnection =
    previous?.composioAccountId && previous.composioAccountId !== ready.staged.composioAccountId

  if (previous && (!isGoogleProvider(provider) || replacedConnection)) void revokeQuietly(previous)

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
  ownPersonalCredentialOptions,
  personalCredentialSubjectFor,
  personalGithubToken,
  personalOwnToken,
  personalGoogleToken,
  personalLinearToken,
} from './handout'
export type { PersonalToken } from './handout'
