import { optional } from './env'

// Chat surfaces the agent talks through, plus product analytics.
export function messagingConfig() {
  return {
    posthog: {
      apiKey: optional('POSTHOG_API_KEY') ?? optional('POSTHOG_PROJECT_API_KEY'),
      host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    },
    slack: {
      signingSecret: optional('SLACK_SIGNING_SECRET'),
      botToken: optional('SLACK_BOT_TOKEN'),
      botUserId: optional('SLACK_BOT_USER_ID'),
      agentUserId: optional('SLACK_AGENT_USER_ID'),
      oauth: {
        clientId: optional('SLACK_OAUTH_CLIENT_ID'),
        clientSecret: optional('SLACK_OAUTH_CLIENT_SECRET'),
        setupRedirect: optional('SLACK_OAUTH_SETUP_REDIRECT'),
        encryptionKey:
          optional('SLACK_TOKEN_ENCRYPTION_KEY') ?? optional('LINEAR_TOKEN_ENCRYPTION_KEY'),
        // Rotation metadata: fixed until key rotation is actually implemented.
        encryptionKeyId: 'default',
      },
    },
    discord: {
      botToken: optional('DISCORD_BOT_TOKEN'),
      clientId: optional('DISCORD_CLIENT_ID'),
      clientSecret: optional('DISCORD_CLIENT_SECRET'),
      oauthRedirect: optional('DISCORD_OAUTH_REDIRECT'),
      publicKey: optional('DISCORD_PUBLIC_KEY'),
    },
    lark: {
      // Lark (Feishu) connector is CUSTOM-APP-ONLY: each Nuphos team registers its
      // own Feishu 企业自建应用 and stores that app's app_secret + event Encrypt Key
      // encrypted in its binding (there is no global Nuphos Lark app). This key
      // encrypts those per-team secrets at rest (AES-256-GCM); falls back to the
      // shared Linear/Slack token key so a single key can cover all connectors.
      encryptionKey:
        optional('LARK_TOKEN_ENCRYPTION_KEY') ?? optional('LINEAR_TOKEN_ENCRYPTION_KEY'),
      encryptionKeyId: optional('LARK_TOKEN_ENCRYPTION_KEY')
        ? (process.env.LARK_TOKEN_ENCRYPTION_KEY_ID ?? 'default')
        : optional('LINEAR_TOKEN_ENCRYPTION_KEY')
          ? (process.env.LINEAR_TOKEN_ENCRYPTION_KEY_ID ?? 'default')
          : (process.env.LARK_TOKEN_ENCRYPTION_KEY_ID ?? 'default'),
    },
    // iOS push. Without the key id, team id and private key, push is off.
    // APNS_ENV is only the fallback for a device that did not report its own
    // environment (Xcode builds register as sandbox, TestFlight as production).
    apns: {
      keyId: optional('APNS_KEY_ID'),
      teamId: optional('APNS_TEAM_ID'),
      bundleId: optional('APNS_BUNDLE_ID') ?? 'ai.nuphos.ios',
      privateKey: optional('APNS_PRIVATE_KEY')?.replaceAll(String.raw`\n`, '\n'),
      environment:
        optional('APNS_ENV') === 'sandbox' ? ('sandbox' as const) : ('production' as const),
    },
  }
}
