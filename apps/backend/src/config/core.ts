import { bool, boundedInt, optional, optionalList, required } from './env'

// Process identity, datastore, admin access, sign-in and the dev TLS pair —
// the settings the process cannot boot without.
export function coreConfig() {
  return {
    port: Number(process.env.PORT ?? 3000),
    // Node runtime environment. Used to gate dev-only middleware; strict equality
    // to 'development' means an unset value reads as non-development (prod-safe).
    nodeEnv: optional('NODE_ENV'),
    // Injected by the local dev launcher; never applies to production backends.
    devLauncherPid:
      process.env.NODE_ENV === 'production' ? undefined : optional('NUPHOS_DEV_LAUNCHER_PID'),
    // Set by deploy/compose and `bun run dev`: runtimes on this machine or the
    // compose network count as internal. Never applies to production backends.
    localStack: process.env.NODE_ENV !== 'production' && bool('NUPHOS_LOCAL_STACK', false),
    // Pod name in k8s (injected by the platform); unset on a dev machine. Used to
    // derive a stable replica identity for the redis pub/sub channel.
    hostname: optional('HOSTNAME'),
    mongoUri: required('MONGODB_URI'),
    mongoDb: process.env.MONGODB_DB ?? 'atlas',
    admin: {
      // Admin access = membership in this team (Zeabur Inc.).
      teamId: optional('ATLAS_ADMIN_TEAM_ID') ?? '69e989027ab63e8d6a0ffcb6',
      cookieNames: optionalList('ATLAS_ADMIN_COOKIE_NAMES'),
    },
    auth: {
      jwtSecret: optional('NUPHOS_JWT_SECRET') ?? optional('JWT_SECRET_KEY'),
      sessionTtlSec: boundedInt('NUPHOS_SESSION_TTL_SEC', 60 * 60 * 24 * 30, {
        min: 60,
        max: 60 * 60 * 24 * 365,
      }),
      publicBaseUrl: (
        optional('NUPHOS_AUTH_BASE_URL') ??
        optional('NUPHOS_PUBLIC_URL') ??
        `http://localhost:${String(process.env.PORT ?? 3000)}`
      ).replace(/\/$/, ''),
      // Browser-facing OAuth authorize base (e.g. https://nuphos.ai, which
      // proxies /oauth/authorize* to the API). Empty = same as publicBaseUrl.
      oauthAuthorizeBaseUrl: optional('NUPHOS_OAUTH_AUTHORIZE_BASE_URL')?.replace(/\/$/, ''),
      google: {
        clientId: optional('GOOGLE_OAUTH_CLIENT_ID'),
        clientSecret: optional('GOOGLE_OAUTH_CLIENT_SECRET'),
      },
    },
    email: {
      // Zeabur Email (ZSend) transactional sender. Both must be set for email
      // OTP sign-in; `from` must use a domain verified in ZSend.
      zsendApiKey: optional('ZSEND_API_KEY'),
      from: optional('NUPHOS_EMAIL_FROM'),
      // Local stacks only: print sign-in codes to the log instead of sending them.
      devLogOtp: process.env.NODE_ENV !== 'production' && bool('NUPHOS_DEV_EMAIL_OTP_LOG', false),
    },
    server: {
      tlsCertPath: optional('ATLAS_DEV_TLS_CERT'),
      tlsKeyPath: optional('ATLAS_DEV_TLS_KEY'),
      // Local stacks only: a second, plain-HTTP listener for local containers
      // that cannot trust the dev TLS certificate. 0 = off.
      devHttpPort:
        process.env.NODE_ENV === 'production'
          ? 0
          : boundedInt('NUPHOS_DEV_HTTP_PORT', 0, { min: 0, max: 65_535 }),
    },
  }
}
