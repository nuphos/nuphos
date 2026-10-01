import type { BindingAccess, EncryptedEnvelope } from '@/models/common'
import type { ObjectId } from 'mongodb'

export type SlackWorkspaceBinding = {
  id: ObjectId
  slackTeamId: string
  slackTeamName: string
  botUserId: string
  encryptedBotToken: EncryptedEnvelope
  installerSlackUserId: string | null
  scope: string
  createdAt: Date
}

// A bound Lark (Feishu) CUSTOM app. Each team registers its own 企业自建应用, so
// the binding holds that app's credentials: appId (plaintext identifier),
// app_secret + event Encrypt Key encrypted at rest. domain picks the Feishu vs
// Lark host. tenantKey/tenantName are learned from the first inbound event (for
// display); the webhook routes by appId (carried in the request URL), because an
// encrypted event body hides the app_id until decrypted.
export type LarkAppBinding = {
  id: ObjectId
  appId: string
  encryptedAppSecret: EncryptedEnvelope
  // The Event Subscription Encrypt Key (used to decrypt + verify webhooks). Every
  // team must set one — the webhook fails closed without it.
  encryptedEncryptKey: EncryptedEnvelope
  domain: 'feishu' | 'larksuite'
  tenantKey?: string
  tenantName?: string
  createdAt: Date
}

export type BetterStackIntegrationBinding = {
  id: ObjectId
  label: string
  // Better Stack's web dashboard team id (e.g. "t74114"), copied by the
  // user from their dashboard URL. The API never exposes it, but it's the
  // only way to deep-link to monitors (/team/<id>/monitors/<id>) — without
  // it we can only link to the dashboard root.
  dashboardTeamId?: string
  // The team's Better Stack Prometheus-integration webhook URL. Created
  // once per BS team in their dashboard (no API for it); Alertmanager in
  // every cluster posts alerts here. Stored so the agent can discover it
  // instead of asking the user to paste it per conversation.
  prometheusWebhookUrl?: string
  encryptedUptimeApiToken?: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  encryptedTelemetryApiToken?: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  createdAt: Date
  access?: BindingAccess
}

export type UptimeKumaInstanceBinding = {
  id: ObjectId
  label: string
  baseUrl: string
  username?: string
  encryptedPassword?: EncryptedEnvelope
  encryptedAuthToken?: EncryptedEnvelope
  createdAt: Date
  access?: BindingAccess
}

// Opting a binding into the data plane is a separate, explicit act from binding
// it: a control-plane client lists devices and edits settings, while this lets
// an agent sandbox join the tailnet as a node and reach the customer's machines.
// Absent on every binding created before this existed, so readers must treat
// missing as disabled rather than inferring capability from the binding itself.
export type TailscaleSandboxAccess = {
  enabled: boolean
  tag: string
  enabledBy: ObjectId
  enabledAt: Date
}

export type TailscaleOAuthClientBinding = {
  id: ObjectId
  label: string
  clientId: string
  // Absent on federated bindings, which hold no secret at all. Present on
  // OAuth-client bindings, including every binding created before federation.
  encryptedClientSecret?: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  // Presence marks the binding as federated: Nuphos signs a short-lived OIDC
  // JWT and exchanges it for an API token, so there is nothing to store, leak
  // or rotate. `audience` is what the customer's trust credential expects.
  federation?: { audience: string }
  createdAt: Date
  access?: BindingAccess
  sandboxAccess?: TailscaleSandboxAccess
}

export type ZeaburIdentityBinding = {
  zeaburId: string
  kind: 'user' | 'team'
  name: string
}

export type ZeaburProviderBinding = {
  id: ObjectId
  encryptedToken: {
    v: 1
    alg: 'A256GCM'
    keyId: string
    iv: string
    authTag: string
    ciphertext: string
  }
  identities: ZeaburIdentityBinding[]
  createdAt: Date
  lastSyncedAt?: Date
}

export type VantaIntegrationBinding = {
  id: ObjectId
  label: string
  /** Display name of the Vanta organization, discovered on bind when the
   *  account-info endpoint is reachable; null otherwise. */
  orgDisplayName: string | null
  /**
   * How this binding authenticates against Vanta.
   * - 'client_credentials': the team pasted a "Manage Vanta" app's
   *   client_id/secret. Works today without Vanta partner approval. A 1-hour
   *   access token is minted on demand and cached in memory only (never
   *   persisted — it's always re-mintable from the client_id/secret).
   * - 'oauth': authorization_code grant from a Vanta *public* integration —
   *   the multi-tenant "click to authorize" flow. Gated on Vanta partner
   *   approval; the model/route scaffold is here so it slots in without a
   *   migration when that lands. Mirrors the Cloudflare oauth shape.
   */
  authType: 'client_credentials' | 'oauth'
  /** Present for client_credentials bindings. clientId is plaintext; the
   *  secret is encrypted at rest. */
  clientCredentials?: {
    clientId: string
    encryptedClientSecret: EncryptedEnvelope
  }
  /** Present for oauth bindings. Short-lived access token is auto-refreshed
   *  from the refresh token before it expires (see lib/byos/vanta.ts). */
  oauth?: {
    clientId: string
    scope: string
    encryptedAccessToken: EncryptedEnvelope
    encryptedRefreshToken: EncryptedEnvelope | null
    accessTokenExpiresAt: Date | null
  }
  createdAt: Date
  access?: BindingAccess
}

export type SecureframeIntegrationBinding = {
  id: ObjectId
  label: string
  /** Secureframe data region — selects the API base URL (US vs UK). */
  region: 'us' | 'uk'
  /** API key identifier (the non-secret half of the credential, paired with the
   *  encrypted secret). Sent as the first token of the Authorization header. */
  apiKey: string
  /** API key secret, encrypted at rest. Secureframe auth is a static
   *  `Authorization: <apiKey> <apiSecret>` header — no token exchange. */
  encryptedApiSecret: EncryptedEnvelope
  createdAt: Date
  access?: BindingAccess
}

export type NotionIntegrationBinding = {
  id: ObjectId
  label: string
  // Notion workspace the integration token is scoped to, discovered on bind via
  // GET /v1/users/me (the bot's `workspace_name`); null when Notion doesn't
  // return it (e.g. some internal-integration tokens).
  workspaceName: string | null
  // The integration's bot user id (from /users/me), for reference/dedup.
  botId: string | null
  // Notion internal integration token (ntn_… or legacy secret_…). Auth is a
  // static `Authorization: Bearer <token>` — no OAuth, no token exchange — so
  // only the token is stored, encrypted at rest.
  encryptedToken: EncryptedEnvelope
  createdAt: Date
  access?: BindingAccess
}

export type ResendIntegrationBinding = {
  id: ObjectId
  label: string
  // What the key is permitted to do, probed on bind via GET /domains. A
  // sending-access key can only POST /emails; surfaced to the agent so it does
  // not attempt management calls that are guaranteed to 401.
  permission: 'full_access' | 'sending_access'
  // Verified sending domains at bind time, for labelling only. Null when the
  // key is sending-access (not allowed to read /domains). Not kept in sync —
  // the agent reads /domains live when it needs the current list.
  domains: string[] | null
  // Resend API key (re_…). Auth is a static `Authorization: Bearer <key>` with
  // no expiry or refresh, so only the key is stored, encrypted at rest.
  encryptedApiKey: EncryptedEnvelope
  createdAt: Date
  access?: BindingAccess
}

export type PosthogRegion = 'us' | 'eu'

export type PosthogProjectRef = {
  id: number
  name: string
  organizationId: string
  organizationName: string | null
}

export type PosthogIntegrationBinding = {
  id: ObjectId
  label: string
  region: PosthogRegion
  // us.posthog.com / eu.posthog.com: the region the grant lives in, used for
  // every API and token call.
  apiBaseUrl: string
  // The Client ID Metadata Document URL the grant was issued to; refreshes
  // must present the same client_id even if the backend's public URL changed.
  clientId: string
  userEmail: string | null
  userUuid: string | null
  projects: PosthogProjectRef[]
  // Projects the user granted on PostHog's consent screen; empty = all.
  scopedTeams: number[]
  // Absent on bindings from before the permission matrix.
  requestedScopes?: string[]
  // Space-separated scopes PostHog granted; may be narrower than requested.
  // Absent, like the tokens, on bindings from the pasted-key era.
  scope?: string
  encryptedAccessToken?: EncryptedEnvelope
  encryptedRefreshToken: EncryptedEnvelope | null
  accessTokenExpiresAt: Date | null
  // Set when PostHog rejected the refresh token; cleared by a reconnect.
  reconnectRequired?: boolean
  createdAt: Date
  access?: BindingAccess
}
