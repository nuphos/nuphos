import { db } from '@/lib/db'

import type { EncryptedEnvelope } from '@/models/common'
import type { Collection, ObjectId } from 'mongodb'

export type GitlabPendingOAuth = {
  // The state token returned to the desktop and echoed back by GitLab.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  hostUrl: string
  clientId: string
  // null when the binding will use the server-default gitlab.com OAuth app.
  encryptedClientSecret: EncryptedEnvelope | null
  // Mongo TTL index removes expired pending records 10 min after expiresAt.
  expiresAt: Date
}

export const gitlabPendingOAuth = (): Collection<GitlabPendingOAuth> =>
  db().collection<GitlabPendingOAuth>('gitlab_oauth_pending')

export type CloudflarePendingOAuth = {
  // The state token returned to the desktop and echoed back by Cloudflare.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // Mongo TTL index removes expired pending records once expiresAt passes.
  expiresAt: Date
}

export const cloudflarePendingOAuth = (): Collection<CloudflarePendingOAuth> =>
  db().collection<CloudflarePendingOAuth>('cloudflare_oauth_pending')

/**
 * Result of a completed Cloudflare OAuth callback, keyed by the same `state`
 * token the desktop holds. The desktop polls this so the bind completes even
 * when the `nuphos://` deep link is captured by another app instance. Holds
 * only non-sensitive metadata (never tokens); a Mongo TTL index reaps it.
 */
export type CloudflareOAuthResult = {
  _id: string
  teamId: ObjectId
  bindingId: ObjectId
  accountId: string
  accountName: string | null
  expiresAt: Date
}

export const cloudflareOAuthResult = (): Collection<CloudflareOAuthResult> =>
  db().collection<CloudflareOAuthResult>('cloudflare_oauth_result')

// ── Vanta public-integration OAuth (scaffold) ──
// Only exercised once VANTA_OAUTH_* is configured (Vanta partner approved).
// The client_credentials bind path does not touch these collections.
export type VantaPendingOAuth = {
  // The state token returned to the desktop and echoed back by Vanta.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // Mongo TTL index removes expired pending records once expiresAt passes.
  expiresAt: Date
}

export const vantaPendingOAuth = (): Collection<VantaPendingOAuth> =>
  db().collection<VantaPendingOAuth>('vanta_oauth_pending')

/**
 * Result of a completed Vanta OAuth callback, keyed by the same `state` token
 * the desktop holds (mirrors CloudflareOAuthResult). Non-sensitive metadata
 * only; a Mongo TTL index reaps it.
 */
export type VantaOAuthResult = {
  _id: string
  teamId: ObjectId
  bindingId: ObjectId
  orgDisplayName: string | null
  expiresAt: Date
}

export const vantaOAuthResult = (): Collection<VantaOAuthResult> =>
  db().collection<VantaOAuthResult>('vanta_oauth_result')

export type LinearPendingOAuth = {
  // The state token returned to the desktop and echoed back by Linear.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // Mongo TTL index removes expired pending records 10 min after expiresAt.
  expiresAt: Date
}

export const linearPendingOAuth = (): Collection<LinearPendingOAuth> =>
  db().collection<LinearPendingOAuth>('linear_oauth_pending')

export type JiraPendingOAuth = {
  // The state token returned to the desktop and echoed back by Atlassian.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // Mongo TTL index removes expired pending records 10 min after expiresAt.
  expiresAt: Date
}

export const jiraPendingOAuth = (): Collection<JiraPendingOAuth> =>
  db().collection<JiraPendingOAuth>('jira_oauth_pending')

export type AsanaPendingOAuth = {
  // The state token returned to the desktop and echoed back by Asana.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // Mongo TTL index removes expired pending records 10 min after expiresAt.
  expiresAt: Date
}

export const asanaPendingOAuth = (): Collection<AsanaPendingOAuth> =>
  db().collection<AsanaPendingOAuth>('asana_oauth_pending')

export type SentryPendingOAuth = {
  // The state token returned to the desktop and echoed back by Sentry.
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // Mongo TTL index removes expired pending records 10 min after expiresAt.
  expiresAt: Date
}

export const sentryPendingOAuth = (): Collection<SentryPendingOAuth> =>
  db().collection<SentryPendingOAuth>('sentry_oauth_pending')

export type SlackPendingOAuth = {
  _id: string
  teamId: ObjectId
  requesterUserId: string
  // On reinstall, the Slack workspace this team is already bound to. The setup
  // callback rejects approval of a different workspace, since Slack's `team`
  // authorize param only pre-selects (does not enforce) it. Absent on a fresh
  // install, where any workspace is accepted.
  expectedSlackTeamId?: string
  expiresAt: Date
}

export const slackPendingOAuth = (): Collection<SlackPendingOAuth> =>
  db().collection<SlackPendingOAuth>('slack_oauth_pending')

export type PosthogPendingOAuth = {
  _id: string
  teamId: ObjectId
  requesterUserId: string
  label: string
  region: 'us' | 'eu'
  clientId: string
  redirectUri: string
  encryptedCodeVerifier: EncryptedEnvelope
  requestedScopes: string[]
  // Reconnect: the binding whose grant this authorization replaces.
  integrationId?: ObjectId
  expiresAt: Date
}

export const posthogPendingOAuth = (): Collection<PosthogPendingOAuth> =>
  db().collection<PosthogPendingOAuth>('posthog_oauth_pending')
