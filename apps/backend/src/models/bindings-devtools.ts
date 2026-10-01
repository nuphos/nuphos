import type { BindingAccess, EncryptedEnvelope } from '@/models/common'
import type { ObjectId } from 'mongodb'

export type GrafanaInstanceBinding = {
  id: ObjectId
  name: string
  grafanaUrl: string
  saToken: string
  createdAt: Date
  access?: BindingAccess
}

export type GithubInstallationBinding = {
  id: ObjectId
  installationId: number
  accountLogin: string
  accountType: 'User' | 'Organization'
  accountId: number
  targetType: 'all' | 'selected'
  createdAt: Date
  access?: BindingAccess
}

export type GitlabBinding = {
  id: ObjectId
  // Normalized host without trailing slash, e.g. "https://gitlab.com" or
  // "https://gitlab.mycompany.com". Used as the API base for this binding.
  hostUrl: string
  // GitLab user id + login that authorised the OAuth grant.
  accountId: number
  username: string
  displayName: string | null
  avatarUrl: string | null
  // OAuth client used for this binding. clientId is plaintext; clientSecret is
  // null when the server-default gitlab.com app was used (i.e. clientId equals
  // the configured GITLAB_OAUTH_CLIENT_ID).
  clientId: string
  encryptedClientSecret: EncryptedEnvelope | null
  scope: string
  encryptedAccessToken: EncryptedEnvelope
  encryptedRefreshToken: EncryptedEnvelope | null
  // Wall-clock expiry of the stored access token. The library refreshes
  // ~60s ahead of this.
  accessTokenExpiresAt: Date | null
  createdAt: Date
  access?: BindingAccess
}

export type LinearWorkspaceBinding = {
  id: ObjectId
  label: string
  // Linear organization (workspace) the OAuth grant is scoped to.
  workspaceId: string
  workspaceName: string
  // urlKey is the slug in linear.app/<urlKey>/… deep links.
  organizationUrlKey: string | null
  // Linear user who authorised the grant.
  accountId: string
  accountName: string | null
  scope: string
  // Linear access tokens live ~24h and the refresh token rotates on every use,
  // so both are stored encrypted and refreshed ~60s ahead of expiry. Bindings
  // created before refresh support have neither field.
  encryptedAccessToken: EncryptedEnvelope
  encryptedRefreshToken?: EncryptedEnvelope | null
  accessTokenExpiresAt?: Date | null
  createdAt: Date
  access?: BindingAccess
}

export type JiraSiteBinding = {
  id: ObjectId
  label: string
  // Atlassian site (cloudId) the OAuth grant is scoped to. Jira REST calls go
  // to api.atlassian.com/ex/jira/<cloudId>/rest/api/3/…
  cloudId: string
  siteName: string
  // Base URL of the site, e.g. https://acme.atlassian.net (for deep links).
  siteUrl: string
  // Atlassian account that authorised the grant.
  accountId: string
  accountName: string | null
  scope: string
  // Atlassian access tokens are short-lived (~1h) and refresh tokens rotate on
  // every use, so both are stored encrypted and refreshed ~60s ahead of expiry.
  encryptedAccessToken: EncryptedEnvelope
  encryptedRefreshToken: EncryptedEnvelope | null
  accessTokenExpiresAt: Date | null
  createdAt: Date
  access?: BindingAccess
}

export type AsanaAccountBinding = {
  id: ObjectId
  label: string
  // Asana user (gid) that authorised the grant. OAuth is account-wide, so a
  // binding represents the connected Asana account, not a single workspace —
  // the agent selects the workspace at query time via the Asana API.
  accountGid: string
  accountName: string | null
  accountEmail: string | null
  scope: string
  // Asana access tokens are short-lived (~1h). The refresh token is long-lived
  // and (unlike Atlassian) does NOT rotate, so both are stored encrypted and
  // the access token is refreshed ~60s ahead of expiry (mirrors GitLab/Jira).
  encryptedAccessToken: EncryptedEnvelope
  encryptedRefreshToken: EncryptedEnvelope | null
  accessTokenExpiresAt: Date | null
  createdAt: Date
  access?: BindingAccess
}

export type SentryAccountBinding = {
  id: ObjectId
  label: string
  // Sentry user that authorised the grant. OAuth is account-wide, so a binding
  // represents the connected Sentry account, not a single organization — the
  // agent selects the org at query time via GET /organizations/.
  userId: string
  userName: string | null
  userEmail: string | null
  scope: string
  // Sentry access tokens live ~30 days and the refresh token IS rotated on every
  // refresh, so both are stored encrypted and the rotated pair is persisted when
  // the access token is refreshed ~60s ahead of expiry (mirrors GitLab/Jira).
  encryptedAccessToken: EncryptedEnvelope
  encryptedRefreshToken: EncryptedEnvelope | null
  accessTokenExpiresAt: Date | null
  createdAt: Date
  access?: BindingAccess
}

export type SonarqubeIntegrationBinding = {
  id: ObjectId
  label: string
  /** Normalized instance origin/base path without a trailing slash. */
  baseUrl: string
  /** SonarQube user token. Analysis tokens are deliberately not stored here. */
  encryptedToken: EncryptedEnvelope
  /** Discovered on bind for capability-aware UI/skill behavior. */
  version: string | null
  createdAt: Date
  access?: BindingAccess
}
