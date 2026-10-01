import { bool, optional } from './env'

// Per-team SaaS connectors. Most bind with a credential the team pastes, so the
// only server-side setting is the BYOK key that encrypts it at rest; the OAuth
// ones additionally need the app's client id/secret and callback URL.
export function byosIntegrationsConfig() {
  return {
    github: {
      appId: optional('GITHUB_APP_ID'),
      appSlug: optional('GITHUB_APP_SLUG'),
      privateKey: optional('GITHUB_APP_PRIVATE_KEY'),
      privateKeyBase64: optional('GITHUB_APP_PRIVATE_KEY_BASE64'),
      setupRedirect: optional('GITHUB_APP_SETUP_REDIRECT'),
      webhookSecret: optional('GITHUB_APP_WEBHOOK_SECRET'),
    },
    gitlab: {
      // OAuth app defaults used when binding gitlab.com. Self-hosted bindings
      // must supply their own clientId/clientSecret per binding (each GitLab
      // instance hosts its own OAuth registrations).
      clientId: optional('GITLAB_OAUTH_CLIENT_ID'),
      clientSecret: optional('GITLAB_OAUTH_CLIENT_SECRET'),
      setupRedirect: optional('GITLAB_OAUTH_SETUP_REDIRECT'),
      webhookSecret: optional('GITLAB_WEBHOOK_SECRET'),
      encryptionKey: optional('GITLAB_TOKEN_ENCRYPTION_KEY'),
      // Rotation metadata: fixed until key rotation is actually implemented.
      // (Cloudflare below keeps an env override — prod sealed data with a
      // non-default id there.)
      encryptionKeyId: 'default',
      // SSRF guard escape hatch: allow binding self-hosted GitLab instances on
      // private/loopback addresses. Off by default; only enable in trusted nets.
      allowPrivateHosts: bool('GITLAB_ALLOW_PRIVATE_HOSTS', false),
    },
    cloudflare: {
      encryptionKey: optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: process.env.CLOUDFLARE_BYOK_ENCRYPTION_KEY_ID ?? 'default',
      // Self-managed OAuth client (https://developers.cloudflare.com/fundamentals/oauth/).
      // Confidential client: backend holds the secret and runs the auth-code
      // exchange. setupRedirect is the backend callback registered on the client
      // (e.g. https://api.nuphos.ai/cloudflare-app/setup).
      oauth: {
        clientId: optional('CLOUDFLARE_OAUTH_CLIENT_ID'),
        clientSecret: optional('CLOUDFLARE_OAUTH_CLIENT_SECRET'),
        setupRedirect: optional('CLOUDFLARE_OAUTH_SETUP_REDIRECT'),
        // Scopes requested at authorize time (subset of what the client is
        // registered with). Cloudflare uses dot+hyphen scope strings, not
        // wrangler's underscore/colon form. Overridable so the exact strings
        // can be tuned without a deploy; the desktop normally sends a subset.
        scopes:
          optional('CLOUDFLARE_OAUTH_SCOPES') ??
          'account-settings.read user-details.read memberships.read zone.read dns.write workers-scripts.write workers-routes.write workers-kv-storage.write d1.write page.write workers-r2.write offline_access',
      },
    },
    linode: {
      encryptionKey:
        optional('LINODE_BYOK_ENCRYPTION_KEY') ?? optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    hetzner: {
      // Bring-your-own-credential: each team provides its own Hetzner Cloud API
      // token at the connect dialog; the token is encrypted at rest with this
      // BYOK key (shared with the other BYOK providers).
      encryptionKey:
        optional('HETZNER_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    tailscale: {
      encryptionKey:
        optional('TAILSCALE_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    zeabur: {
      encryptionKey:
        optional('ZEABUR_PROVIDER_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    betterStack: {
      encryptionKey: optional('BETTERSTACK_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    uptimeKuma: {
      encryptionKey:
        optional('UPTIME_KUMA_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    vanta: {
      encryptionKey:
        optional('VANTA_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
      // Public-integration (partner) OAuth app — scaffold only. The
      // client_credentials bind path (team pastes its own Manage Vanta app's
      // client_id/secret) needs none of this. Set these once the Vanta public
      // integration is approved to enable the "click to authorize" flow.
      oauth: {
        clientId: optional('VANTA_OAUTH_CLIENT_ID'),
        clientSecret: optional('VANTA_OAUTH_CLIENT_SECRET'),
        // Public HTTPS URL of the backend's /vanta-app/setup callback; must
        // match the redirect URI registered on the Vanta public integration.
        setupRedirect: optional('VANTA_OAUTH_SETUP_REDIRECT'),
        // Scope requested on the public-integration (connector) flow — scaffold.
        scopes: optional('VANTA_OAUTH_SCOPES') ?? 'connectors.self:read-resource',
      },
    },
    secureframe: {
      // Secureframe authenticates with a static API key + secret pair (no
      // OAuth), so the only server-side config is the encryption key for the
      // secret at rest.
      encryptionKey:
        optional('SECUREFRAME_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    sonarqube: {
      // SonarQube binds with a static user token pasted by a team admin. Keep
      // it encrypted at rest with the shared BYOS fallback chain so existing
      // self-hosted deployments do not need a new key just to enable this
      // connector, while still allowing independent rotation later.
      encryptionKey:
        optional('SONARQUBE_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
      // Development-only proof path: exposes an Agent tool that can scan the
      // checked-in isolated fixture. It never accepts a repository or path and
      // remains off in every deployment unless explicitly enabled.
      fixtureScannerEnabled: bool('SONARQUBE_FIXTURE_SCANNER_ENABLED', false),
    },
    notion: {
      // Notion binds with a static internal-integration token (ntn_… / legacy
      // secret_…) pasted by the user — no OAuth — so the only server-side config
      // is the encryption key for the token at rest.
      encryptionKey:
        optional('NOTION_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    upstash: {
      // Upstash binds with an account email + a Management API key pasted by the
      // user (Console → Account → Management API) — no OAuth — so the only
      // server-side config is the encryption key for the API key at rest.
      encryptionKey:
        optional('UPSTASH_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    posthog: {
      encryptionKey:
        optional('POSTHOG_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    resend: {
      // Resend binds with a static API key (re_…) pasted by the user — no OAuth
      // — so the only server-side config is the encryption key for it at rest.
      encryptionKey:
        optional('RESEND_BYOK_ENCRYPTION_KEY') ??
        optional('LINODE_BYOK_ENCRYPTION_KEY') ??
        optional('CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    linear: {
      // OAuth2 app the team authorises against. Linear has a single hosted
      // instance, so unlike GitLab there are no per-binding client overrides.
      clientId: optional('LINEAR_OAUTH_CLIENT_ID'),
      clientSecret: optional('LINEAR_OAUTH_CLIENT_SECRET'),
      // Public HTTPS URL of the backend's /linear-app/setup callback; must
      // match the redirect URI registered on the Linear OAuth app.
      setupRedirect: optional('LINEAR_OAUTH_SETUP_REDIRECT'),
      // Signing secret of the Linear app's webhook. The /linear-app/webhook
      // endpoint verifies the Linear-Signature HMAC against it. Reverse-sync
      // (Linear → agent) is not implemented yet; the endpoint only acks so the
      // webhook can be wired up in the Linear app ahead of that work.
      webhookSecret: optional('LINEAR_WEBHOOK_SECRET'),
      encryptionKey: optional('LINEAR_TOKEN_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    jira: {
      // Atlassian OAuth 2.0 (3LO) app the team authorises against. Jira Cloud is
      // a single hosted instance; per-site access is resolved post-auth via the
      // accessible-resources endpoint (cloudId), not a per-binding client.
      clientId: optional('JIRA_OAUTH_CLIENT_ID'),
      clientSecret: optional('JIRA_OAUTH_CLIENT_SECRET'),
      // Public HTTPS URL of the backend's /jira-app/setup callback; must match
      // the callback URL registered on the Atlassian OAuth app.
      setupRedirect: optional('JIRA_OAUTH_SETUP_REDIRECT'),
      // Atlassian access tokens expire (~1h) and rotate refresh tokens; both are
      // encrypted at rest with this key (mirrors GitLab).
      encryptionKey: optional('JIRA_TOKEN_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    asana: {
      // Asana OAuth 2.0 app the team authorises against. Asana is a single
      // hosted instance (app.asana.com); a binding represents the connected
      // Asana account, and the agent picks a workspace at query time.
      clientId: optional('ASANA_OAUTH_CLIENT_ID'),
      clientSecret: optional('ASANA_OAUTH_CLIENT_SECRET'),
      // Public HTTPS URL of the backend's /asana-app/setup callback; must match
      // the redirect URL registered on the Asana OAuth app.
      setupRedirect: optional('ASANA_OAUTH_SETUP_REDIRECT'),
      // Asana access tokens expire (~1h); the long-lived refresh token does not
      // rotate. Both are encrypted at rest with this key (mirrors Jira).
      encryptionKey: optional('ASANA_TOKEN_ENCRYPTION_KEY'),
      encryptionKeyId: 'default',
    },
    sentry: {
      // Sentry OAuth 2.0 application the team authorises against. Sentry is a
      // single hosted instance (sentry.io); a binding represents the connected
      // Sentry account, and the agent picks an organization at query time.
      clientId: optional('SENTRY_OAUTH_CLIENT_ID'),
      clientSecret: optional('SENTRY_OAUTH_CLIENT_SECRET'),
      // Public HTTPS URL of the backend's /sentry-app/setup callback; must match
      // a redirect URL registered on the Sentry OAuth application.
      setupRedirect: optional('SENTRY_OAUTH_SETUP_REDIRECT'),
      // Sentry access tokens expire (~30d) and the refresh token rotates on use.
      // Both are encrypted at rest with this key (mirrors Jira).
      encryptionKey: optional('SENTRY_TOKEN_ENCRYPTION_KEY'),
      encryptionKeyId: process.env.SENTRY_TOKEN_ENCRYPTION_KEY_ID ?? 'default',
    },
  }
}
