import { bindingOwner, canUseBinding, isPrivateAccess } from './access'

import type { BindingAccess } from '@/models/common'

const PROVIDERS: Record<string, string> = {
  awsRoles: 'aws',
  gcpServiceAccounts: 'gcp',
  azureAccounts: 'azure',
  cloudflareAccounts: 'cloudflare',
  githubInstallations: 'github',
  gitlabAccounts: 'gitlab',
  linearWorkspaces: 'linear',
  jiraSites: 'jira',
  asanaAccounts: 'asana',
  sentryAccounts: 'sentry',
  posthogIntegrations: 'posthog',
  plaudAccounts: 'plaud',
  grafanaInstances: 'grafana',
  linodeAccounts: 'linode',
  hetznerAccounts: 'hetzner',
  onpremClusters: 'onprem-k8s',
  betterStackIntegrations: 'betterstack',
  uptimeKumaInstances: 'uptime-kuma',
  tailscaleClients: 'tailscale',
  zeaburProviders: 'zeabur',
  vantaIntegrations: 'vanta',
  secureframeIntegrations: 'secureframe',
  sonarqubeIntegrations: 'sonarqube',
  notionIntegrations: 'notion',
  upstashAccounts: 'upstash',
  resendIntegrations: 'resend',
  trelloIntegrations: 'trello',
  instaboxAccounts: 'instabox',
  tencentAccounts: 'tencent',
  aliyunAccounts: 'aliyun',
  volcengineAccounts: 'volcengine',
  huaweiAccounts: 'huawei',
}

type SharingItem = { owned: boolean; shared: boolean }

/** A safe classification for catalog rows; never return tokens or other members' private entries. */
export function connectorSharing(
  doc: object | null,
  userId: string,
  role: string,
): Record<string, SharingItem> {
  const result: Record<string, SharingItem> = {}

  for (const [field, provider] of Object.entries(PROVIDERS)) {
    const items: unknown = Reflect.get(doc ?? {}, field)

    if (!Array.isArray(items)) continue
    for (const item of items as {
      id?: { toString(): string }
      access?: BindingAccess
      roleArn?: string
      projectId?: string
      subscriptionId?: string
      accountId?: string
      installationId?: number
      zeaburId?: string
    }[]) {
      if (!item || typeof item !== 'object') continue

      const owned = bindingOwner(item.access) === userId
      const shared = !isPrivateAccess(item.access)

      if (!owned && !canUseBinding(item.access, userId, role)) continue
      const identityFields: Record<string, string | number | undefined> = {
        aws: item.roleArn?.match(/::(\d+):/)?.[1],
        gcp: item.projectId,
        azure: item.subscriptionId,
        cloudflare: item.accountId,
        github: item.installationId,
        zeabur: item.zeaburId,
      }
      const id = Object.hasOwn(identityFields, provider)
        ? identityFields[provider]
        : item.id?.toString()

      if (id === undefined) continue
      const key = `${provider}:${String(id)}`
      const previous = result[key]

      result[key] = {
        owned: owned || Boolean(previous?.owned),
        shared: shared || Boolean(previous?.shared),
      }
    }
  }

  return result
}
