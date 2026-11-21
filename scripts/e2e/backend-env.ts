// The backend as the e2e stack runs it, on `port` and `mongoUri`; nothing here is a real credential.
import { E2E_JWT_SECRET } from './slack-stub.ts'

export function backendEnv(port: number, apiUrl: string, mongoUri: string) {
  return {
    NODE_ENV: 'development',
    PORT: String(port),
    // Loopback only, as MongoDB is: other machines on the network cannot reach the stack.
    NUPHOS_LISTEN_HOST: '127.0.0.1',
    NUPHOS_JWT_SECRET: E2E_JWT_SECRET,
    MONGODB_URI: mongoUri,
    MONGODB_DB: 'nuphos_e2e',
    ATLAS_REDIS_ENABLED: 'false',
    NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
    NUPHOS_LOCAL_STACK: 'true',
    // Cloudflare is never reached: a scenario answers for it on this redirect.
    CLOUDFLARE_OAUTH_CLIENT_ID: 'e2e-cloudflare-client',
    CLOUDFLARE_OAUTH_CLIENT_SECRET: 'e2e-cloudflare-secret-not-a-production-credential',
    CLOUDFLARE_OAUTH_SETUP_REDIRECT: `${apiUrl}/cloudflare-app/setup`,
    // GitLab: a scenario serves the instance on this computer and answers its redirect.
    GITLAB_OAUTH_SETUP_REDIRECT: `${apiUrl}/gitlab-app/setup`,
    GITLAB_TOKEN_ENCRYPTION_KEY: 'bG9jYWwtZTJlLWdpdGxhYi1rZXktbm90LXByb2R1Y3Q=',
    OUTBOUND_ALLOW_PRIVATE_HOSTS: 'true',
    // Seals two-factor secrets (sealers.mfa).
    LINODE_BYOK_ENCRYPTION_KEY: 'bG9jYWwtZTJlLWxpbm9kZS1rZXktbm90LXByb2R1Y3Q=',
    SONARQUBE_BYOK_ENCRYPTION_KEY: 'bG9jYWwtZTJlLXNvbmFycXViZS1rZXktbm90LXByb2Q=',
    // Where the agent reaches the backend's tools, as a runtime on this computer would.
    NUPHOS_BACKEND_URL: apiUrl,
    // Voice input as on Nuphos Cloud, for a subscription the e2e team lacks; never reached.
    NUPHOS_BILLING_URL: `${apiUrl}/e2e-billing`,
    OPENAI_API_KEY: 'e2e-openai-key-not-a-production-credential',
  }
}
