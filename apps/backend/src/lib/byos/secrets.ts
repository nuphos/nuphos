import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { createSealer } from './secrets/shared'

import type { EncryptedSecret } from './secrets/shared'

export type { EncryptedSecret } from './secrets/shared'

const LINODE = 'LINODE_BYOK_ENCRYPTION_KEY'
const CLOUDFLARE = 'CLOUDFLARE_BYOK_ENCRYPTION_KEY'
const LINEAR = 'LINEAR_TOKEN_ENCRYPTION_KEY'
// Most BYOK providers fall back to the Linode, then the Cloudflare key.
const byok = (env: string) => [env, LINODE, CLOUDFLARE]

/**
 * One sealer per BYOK key. The key lists mirror the fallbacks in @/config, and
 * the rewrap script uses these names to pick the sealer for each stored field.
 */
export const sealers = {
  asana: createSealer({
    subject: 'Asana credentials',
    keyEnvs: ['ASANA_TOKEN_ENCRYPTION_KEY'],
    keyId: () => config.byos.asana.encryptionKeyId,
    recovery: 'Re-bind the Asana account.',
  }),
  betterStack: createSealer({
    subject: 'Better Stack credentials',
    keyEnvs: ['BETTERSTACK_BYOK_ENCRYPTION_KEY'],
    keyId: () => config.byos.betterStack.encryptionKeyId,
    recovery: 'Re-bind the Better Stack integration.',
  }),
  cloudflare: createSealer({
    subject: 'Cloudflare credentials',
    keyEnvs: [CLOUDFLARE],
    keyId: () => config.byos.cloudflare.encryptionKeyId,
    recovery: "Re-bind the Cloudflare account so it's encrypted with the current key.",
  }),
  github: createSealer({
    subject: 'GitHub user token',
    keyEnvs: ['GITHUB_TOKEN_ENCRYPTION_KEY'],
    keyId: () => config.byos.github.encryptionKeyId,
    recovery: 'Reconnect GitHub under Settings → Personal Credentials.',
  }),
  gitlab: createSealer({
    subject: 'GitLab credentials',
    keyEnvs: ['GITLAB_TOKEN_ENCRYPTION_KEY'],
    keyId: () => config.byos.gitlab.encryptionKeyId,
    recovery: 'Re-bind the GitLab account.',
  }),
  grafana: createSealer({
    subject: 'Grafana credentials',
    keyEnvs: byok('GRAFANA_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.grafana.encryptionKeyId,
    recovery: 'Re-bind the Grafana instance.',
  }),
  hetzner: createSealer({
    subject: 'Hetzner credentials',
    keyEnvs: byok('HETZNER_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.hetzner.encryptionKeyId,
    recovery: 'Re-bind the Hetzner account.',
  }),
  jira: createSealer({
    subject: 'Jira credentials',
    keyEnvs: ['JIRA_TOKEN_ENCRYPTION_KEY'],
    keyId: () => config.byos.jira.encryptionKeyId,
    recovery: 'Re-bind the Jira site.',
  }),
  lark: createSealer({
    subject: 'Lark credentials',
    keyEnvs: ['LARK_TOKEN_ENCRYPTION_KEY', LINEAR],
    keyId: () => config.lark.encryptionKeyId,
    recovery: 'Re-connect the Lark app.',
  }),
  linear: createSealer({
    subject: 'Linear credentials',
    keyEnvs: [LINEAR],
    keyId: () => config.byos.linear.encryptionKeyId,
    recovery: 'Re-bind the Linear workspace.',
  }),
  linode: createSealer({
    subject: 'Linode credentials',
    keyEnvs: [LINODE, CLOUDFLARE],
    keyId: () => config.byos.linode.encryptionKeyId,
    recovery: 'Re-bind the Linode account.',
  }),
  notion: createSealer({
    subject: 'Notion credentials',
    keyEnvs: byok('NOTION_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.notion.encryptionKeyId,
    recovery: 'Re-bind the Notion integration.',
  }),
  // On-prem kubeconfigs share the Linode key: both are customer-issued secrets.
  onprem: createSealer({
    subject: 'on-prem cluster kubeconfig',
    keyEnvs: [LINODE, CLOUDFLARE],
    keyId: () => config.byos.linode.encryptionKeyId,
    recovery: 'Re-enrol the cluster.',
  }),
  plaud: createSealer({
    subject: 'Plaud credentials',
    keyEnvs: byok('PLAUD_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.plaud.encryptionKeyId,
    recovery: 'Reconnect the Plaud account.',
  }),
  posthog: createSealer({
    subject: 'PostHog credentials',
    keyEnvs: byok('POSTHOG_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.posthog.encryptionKeyId,
    recovery: 'Re-bind the PostHog integration.',
  }),
  resend: createSealer({
    subject: 'Resend credentials',
    keyEnvs: byok('RESEND_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.resend.encryptionKeyId,
    recovery: 'Re-bind the Resend integration.',
  }),
  secureframe: createSealer({
    subject: 'Secureframe credentials',
    keyEnvs: byok('SECUREFRAME_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.secureframe.encryptionKeyId,
    recovery: 'Re-bind the Secureframe integration.',
  }),
  sentry: createSealer({
    subject: 'Sentry credentials',
    keyEnvs: ['SENTRY_TOKEN_ENCRYPTION_KEY'],
    keyId: () => config.byos.sentry.encryptionKeyId,
    recovery: 'Re-bind the Sentry account.',
  }),
  slack: createSealer({
    subject: 'Slack credentials',
    keyEnvs: ['SLACK_TOKEN_ENCRYPTION_KEY', LINEAR],
    keyId: () => config.slack.oauth.encryptionKeyId,
    recovery: 'Re-install the Slack app.',
  }),
  sonarqube: createSealer({
    subject: 'SonarQube credential',
    keyEnvs: byok('SONARQUBE_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.sonarqube.encryptionKeyId,
    recovery: 'Re-bind the SonarQube integration.',
  }),
  tailscale: createSealer({
    subject: 'Tailscale credentials',
    keyEnvs: byok('TAILSCALE_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.tailscale.encryptionKeyId,
    recovery: 'Re-bind the OAuth client.',
  }),
  upstash: createSealer({
    subject: 'Upstash credentials',
    keyEnvs: byok('UPSTASH_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.upstash.encryptionKeyId,
    recovery: 'Re-bind the Upstash account.',
  }),
  uptimeKuma: createSealer({
    subject: 'Uptime Kuma credentials',
    keyEnvs: byok('UPTIME_KUMA_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.uptimeKuma.encryptionKeyId,
    recovery: 'Re-bind the Uptime Kuma instance.',
  }),
  vanta: createSealer({
    subject: 'Vanta credentials',
    keyEnvs: byok('VANTA_BYOK_ENCRYPTION_KEY'),
    keyId: () => config.byos.vanta.encryptionKeyId,
    recovery: 'Re-bind the Vanta integration.',
  }),
  zeabur: createSealer({
    subject: 'Zeabur credentials',
    keyEnvs: byok('ZEABUR_PROVIDER_ENCRYPTION_KEY'),
    keyId: () => config.byos.zeabur.encryptionKeyId,
    recovery: 'Re-bind the Zeabur provider.',
  }),
}

export type SealerName = keyof typeof sealers

export const { seal: encryptAsanaSecret, open: decryptAsanaSecret } = sealers.asana
export const { seal: encryptBetterStackToken, open: decryptBetterStackToken } = sealers.betterStack
export const { seal: encryptCloudflareApiKey, open: decryptCloudflareApiKey } = sealers.cloudflare
export const { seal: encryptGithubSecret, open: decryptGithubSecret } = sealers.github
export const { seal: encryptGitlabSecret, open: decryptGitlabSecret } = sealers.gitlab
export const { seal: encryptGrafanaSecret, open: decryptGrafanaSecret } = sealers.grafana
export const { seal: encryptHetznerToken, open: decryptHetznerToken } = sealers.hetzner
export const { seal: encryptJiraSecret, open: decryptJiraSecret } = sealers.jira
export const { seal: encryptLarkSecret, open: decryptLarkSecret } = sealers.lark
export const { seal: encryptLinearSecret, open: decryptLinearSecret } = sealers.linear
export const { seal: encryptLinodeToken, open: decryptLinodeToken } = sealers.linode
export const { seal: encryptNotionSecret, open: decryptNotionSecret } = sealers.notion
export const { seal: encryptOnpremKubeconfig, open: decryptOnpremKubeconfig } = sealers.onprem
export const { seal: encryptPlaudSecret, open: decryptPlaudSecret } = sealers.plaud
export const { seal: encryptPosthogSecret, open: decryptPosthogSecret } = sealers.posthog
export const { seal: encryptResendSecret, open: decryptResendSecret } = sealers.resend
export const { seal: encryptSecureframeSecret, open: decryptSecureframeSecret } =
  sealers.secureframe
export const { seal: encryptSentrySecret, open: decryptSentrySecret } = sealers.sentry
export const { seal: encryptSlackSecret, open: decryptSlackSecret } = sealers.slack
export const { seal: encryptSonarqubeSecret, open: decryptSonarqubeSecret } = sealers.sonarqube
export const { seal: encryptTailscaleClientSecret, open: decryptTailscaleClientSecret } =
  sealers.tailscale
export const { seal: encryptUpstashSecret, open: decryptUpstashSecret } = sealers.upstash
export const { seal: encryptUptimeKumaSecret, open: decryptUptimeKumaSecret } = sealers.uptimeKuma
export const { seal: encryptVantaSecret, open: decryptVantaSecret } = sealers.vanta
export const { seal: encryptZeaburToken, open: decryptZeaburToken } = sealers.zeabur

export function grafanaBindingToken(binding: {
  encryptedSaToken?: EncryptedSecret
  saToken?: string
}): string {
  if (binding.encryptedSaToken) return decryptGrafanaSecret(binding.encryptedSaToken)
  if (binding.saToken) return binding.saToken
  throw new AppError(422, 'credential_missing', 'The Grafana binding has no token. Re-bind it.')
}
