// Gmail and Google Drive through Composio-managed auth, for teams that have
// not added their own Google OAuth client. Composio holds the Google grant;
// Nuphos keeps only the connected account id and runs tools through it with
// its own server-side API key. https://docs.composio.dev/docs/authenticating-users
import { composioAuthConfigId, composioRequest as call } from '@/lib/composio'
import { AppError } from '@/lib/errors'
import { personalCredentialPendingOAuth } from '@/models'

import type { GoogleProvider } from './google'
import type { PersonalCredentialPendingOAuth } from '@/models'

const PROFILE: Record<
  GoogleProvider,
  { toolkit: string; tool: string; email: (data: unknown) => unknown }
> = {
  gmail: {
    toolkit: 'gmail',
    tool: 'GMAIL_GET_PROFILE',
    email: (d) => (d as { emailAddress?: unknown }).emailAddress,
  },
  'google-drive': {
    toolkit: 'googledrive',
    tool: 'GOOGLEDRIVE_GET_ABOUT',
    email: (d) => (d as { user?: { emailAddress?: unknown } }).user?.emailAddress,
  },
}

// The same reach as a team-client grant. Its gmail.modify scope cannot permanently delete
// mail, so those tools are refused. Its Drive scope is full `drive`, which can delete files
// and empty the trash, so Drive keeps those tools.
const BLOCKED = new Set([
  'GMAIL_DELETE_MESSAGE',
  'GMAIL_DELETE_THREAD',
  'GMAIL_BATCH_DELETE_MESSAGES',
])

/** The toolkit an agent's tool belongs to, so it can only use the member's own connection for it. */
export function composioToolProvider(tool: string): GoogleProvider | null {
  if (BLOCKED.has(tool)) return null
  if (/^GMAIL_[A-Z0-9_]+$/u.test(tool)) return 'gmail'
  if (/^GOOGLEDRIVE_[A-Z0-9_]+$/u.test(tool)) return 'google-drive'

  return null
}

/** Connected accounts are per Nuphos team and member, like the team-client grants. */
export const composioUserId = (teamId: string, userId: string) => `${teamId}:${userId}`

/** A Connect Link for the member; Composio returns to callbackUrl when they finish. */
export async function createComposioLink(args: {
  provider: GoogleProvider
  composioUserId: string
  callbackUrl: string
}): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const res = await call<{ redirect_url: string; connected_account_id: string }>(
    'POST',
    '/connected_accounts/link',
    {
      auth_config_id: await composioAuthConfigId(PROFILE[args.provider].toolkit),
      user_id: args.composioUserId,
      callback_url: args.callbackUrl,
    },
  )

  return { redirectUrl: res.redirect_url, connectedAccountId: res.connected_account_id }
}

export type ComposioResult = { successful: boolean; data: unknown; error: string | null }

export function executeComposioTool(args: {
  tool: string
  connectedAccountId: string
  composioUserId: string
  arguments: Record<string, unknown>
}): Promise<ComposioResult> {
  return call<ComposioResult>('POST', `/tools/execute/${args.tool}`, {
    connected_account_id: args.connectedAccountId,
    user_id: args.composioUserId,
    arguments: args.arguments,
    version: 'latest',
  })
}

/** Whether the member finished connecting, and the Google account they connected. */
export async function composioConnection(
  provider: GoogleProvider,
  connectedAccountId: string,
  composioUserId: string,
): Promise<{ login: string } | null> {
  const account = await call<{ status?: string }>(
    'GET',
    `/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
  )

  if (account.status !== 'ACTIVE') return null
  const profile = await executeComposioTool({
    tool: PROFILE[provider].tool,
    connectedAccountId,
    composioUserId,
    arguments: {},
  }).catch(() => null)
  const email = profile?.successful ? PROFILE[provider].email(profile.data) : null

  return { login: typeof email === 'string' && email ? email : 'Google account' }
}

/**
 * Deletes the connection, which stops it working at once. Not revoked at
 * Google: Composio's managed app is one Google client, so a revoke would also
 * end the member's other Composio connections, here and in other products.
 */
export async function deleteComposioAccount(connectedAccountId: string): Promise<void> {
  try {
    await call('DELETE', `/connected_accounts/${encodeURIComponent(connectedAccountId)}`)
  } catch (error) {
    const status =
      error instanceof AppError
        ? (error.details as { upstreamStatus?: number } | undefined)?.upstreamStatus
        : undefined

    if (status !== 404) throw error
  }
}

/** Starts connecting through a Connect Link, remembering the account it creates. */
export async function startComposioConnection(args: {
  provider: GoogleProvider
  userId: string
  teamId: string
  state: string
  redirectUri: string
  expiresAt: Date
}): Promise<{ authorizeUrl: string; state: string }> {
  const link = await createComposioLink({
    provider: args.provider,
    composioUserId: composioUserId(args.teamId, args.userId),
    callbackUrl: `${args.redirectUri}?state=${args.state}`,
  })

  await personalCredentialPendingOAuth().insertOne({
    _id: args.state,
    userId: args.userId,
    provider: args.provider,
    teamId: args.teamId,
    composioAccountId: link.connectedAccountId,
    expiresAt: args.expiresAt,
  })

  return { state: args.state, authorizeUrl: link.redirectUrl }
}

/**
 * The connection to stage once the member returns. Its account id comes from
 * the flow's start, never the callback URL, and Composio must report it active.
 */
export async function stagedComposioConnection(
  provider: GoogleProvider,
  accountId: string,
  pending: { userId: string; teamId: string },
  teamName: string,
): Promise<NonNullable<PersonalCredentialPendingOAuth['staged']>> {
  const { teamId } = pending
  const connection = await composioConnection(
    provider,
    accountId,
    composioUserId(teamId, pending.userId),
  )

  if (!connection) {
    throw new AppError(400, 'composio_not_connected', 'The Google account was not connected')
  }

  return {
    providerUserId: accountId,
    login: connection.login,
    teamId,
    workspaceName: teamName,
    composioAccountId: accountId,
    encryptedRefreshToken: null,
    accessTokenExpiresAt: null,
  }
}
