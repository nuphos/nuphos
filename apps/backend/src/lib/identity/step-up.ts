import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { isMfaEnabled } from '@/lib/identity/mfa'
import { userSessions } from '@/lib/identity/sessions'

/**
 * Step-up re-authentication. A session counts as recently verified for
 * WINDOW_MS after it was signed in to, or after its last `markVerified` (a
 * code entered on POST /auth/mfa/reauth). With MFA on, sign-in itself needed
 * the second factor, so either moment is a second-factor check.
 *
 * MFA is optional, so accounts without it are only asked for a recent sign-in
 * where `forEveryAccount` says so (turning MFA on); elsewhere they pass.
 */
const WINDOW_MS = 10 * 60 * 1000

/** Where a tool or cloud credential is bound to a team. */
const CONNECTORS = [
  'aliyun-accounts',
  'asana-accounts',
  'aws-accounts',
  'azure-accounts',
  'betterstack-integrations',
  'cloudflare-accounts',
  'database-connections',
  'gcp-projects',
  'github-installations',
  'gitlab-bindings',
  'google-oauth-client',
  'grafana-instances',
  'hetzner-accounts',
  'huawei-accounts',
  'instabox-accounts',
  'jira-sites',
  'linear-workspaces',
  'linode-accounts',
  'notion-integrations',
  'onprem-clusters',
  'plaud-accounts',
  'posthog-integrations',
  'resend-integrations',
  'secureframe-integrations',
  'sentry-accounts',
  'sonarqube-integrations',
  'tailscale-clients',
  'tencent-accounts',
  'trello-integrations',
  'upstash-accounts',
  'uptime-kuma-instances',
  'vanta-integrations',
  'volcengine-accounts',
  'zeabur-providers',
].join('|')

/** The sensitive actions: what a stolen session should not be able to do alone. */
const STEP_UP: [RegExp, RegExp][] = [
  // Connecting or changing a credential, including starting its OAuth flow.
  // `test` only tries a connection and binds nothing.
  [/^(POST|PUT|PATCH)$/, new RegExp(`^/teams/[^/]+/(${CONNECTORS})(/(?!test/?$)[^/]+)?/?$`)],
  [/^POST$/, /^\/teams\/[^/]+\/connector-oauth\/[^/]+\/complete\/?$/],
  [/^POST$/, /^\/personal-credentials\/[^/]+\/(start|complete)\/?$/],
  // Minting a credential for a terminal, a device or an agent.
  [/^POST$/, /^\/auth\/cli-tokens\/?$/],
  [/^POST$/, /^\/auth\/device\/approve\/?$/],
  [/^POST$/, /^\/agent\/devices\/join-tokens\/?$/],
  // The team and the account themselves.
  [/^DELETE$/, /^\/teams\/[^/]+\/?$/],
  [/^PATCH$/, /^\/teams\/[^/]+\/members\/[^/]+\/?$/],
  [/^POST$/, /^\/teams\/[^/]+\/transfer-ownership\/?$/],
  [/^POST$/, /^\/auth\/account-deletion\/?$/],
]

export function isStepUpRoute(method: string, path: string): boolean {
  return STEP_UP.some(([m, p]) => m.test(method) && p.test(path))
}

export async function requireRecentVerification(
  userId: string,
  sessionId: string | undefined,
  forEveryAccount = false,
): Promise<void> {
  const mfa = await isMfaEnabled(userId)

  if (!mfa && !forEveryAccount) return
  // A sign-in from before sessions has nothing to verify against.
  if (!sessionId) throw new AppError(403, 'session_required', 'Sign in again to continue')
  const session = await userSessions().findOne(
    { _id: new ObjectId(sessionId) },
    { projection: { createdAt: 1, verifiedAt: 1 } },
  )
  const verifiedAt = session?.verifiedAt ?? session?.createdAt

  if (verifiedAt && Date.now() - verifiedAt.getTime() < WINDOW_MS) return
  // `method` tells the app what to ask for: a code, or signing in again.
  throw new AppError(
    403,
    'reauth_required',
    mfa ? 'Enter a code from your authenticator app to continue.' : 'Sign in again to continue.',
    { method: mfa ? 'mfa' : 'sign_in' },
  )
}

export async function markVerified(sessionId: string): Promise<void> {
  await userSessions().updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { verifiedAt: new Date() } },
  )
}
