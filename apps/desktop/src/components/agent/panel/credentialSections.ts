import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

export type CredentialSelectorControl = {
  options: AgentCredentialOptions
  value: AgentCredentialSelection
  saving: boolean
  /** Options bound to the team since this conversation's selection was last saved. */
  unseen?: AgentCredentialSelection
  /** Called when the menu opens, to refresh available credential options. */
  onOpen: () => void
  onChange: (value: AgentCredentialSelection) => void
}

export type CredentialSection = {
  id: string
  provider:
    | 'aws'
    | 'gcp'
    | 'linode'
    | 'hetzner'
    | 'tencent'
    | 'aliyun'
    | 'volcengine'
    | 'huawei'
    | 'azure'
    | 'onprem-k8s'
    | 'betterstack'
    | 'uptime-kuma'
    | 'linear'
    | 'jira'
    | 'asana'
    | 'sentry'
    | 'posthog'
    | 'tailscale'
    | 'zeabur'
    | 'vanta'
    | 'secureframe'
    | 'resend'
    | 'github'
    | 'gitlab'
    | 'grafana'
    | 'sonarqube'
    | 'notion'
    | 'upstash'
    | 'cloudflare'
    | 'device'
  title: string
  subtitle?: string
  items: { id: string; label: string; sublabel: string }[]
}

export function awsRoleName(roleArn: string): string {
  return roleArn.split('/').pop() || roleArn
}

export function serviceAccountName(serviceAccountEmail: string): string {
  return serviceAccountEmail.split('@')[0] || serviceAccountEmail
}

export function buildAwsCredentialSections(
  roles: AgentCredentialOptions['awsRoles'],
): CredentialSection[] {
  const sections = new Map<string, CredentialSection>()

  for (const role of roles) {
    const section = sections.get(role.accountId) ?? {
      id: role.accountId,
      provider: 'aws' as const,
      title: role.accountAlias || role.accountId,
      subtitle: role.accountAlias ? role.accountId : undefined,
      items: [],
    }

    section.items.push({
      id: role.roleId,
      label: awsRoleName(role.roleArn),
      sublabel: role.roleArn,
    })
    sections.set(role.accountId, section)
  }

  return Array.from(sections.values())
}

export function buildGcpCredentialSections(
  serviceAccounts: AgentCredentialOptions['gcpServiceAccounts'],
): CredentialSection[] {
  const sections = new Map<string, CredentialSection>()

  for (const account of serviceAccounts) {
    const section = sections.get(account.projectId) ?? {
      id: account.projectId,
      provider: 'gcp' as const,
      title: account.projectId,
      items: [],
    }

    section.items.push({
      id: account.serviceAccountId,
      label: serviceAccountName(account.serviceAccountEmail),
      sublabel: account.serviceAccountEmail,
    })
    sections.set(account.projectId, section)
  }

  return Array.from(sections.values())
}

export function buildOnpremCredentialSections(
  clusters: AgentCredentialOptions['onpremClusters'],
): CredentialSection[] {
  if (clusters.length === 0) return []

  return [
    {
      id: 'onprem-k8s',
      provider: 'onprem-k8s' as const,
      title: 'Kubernetes',
      items: clusters.map((cluster) => ({
        id: cluster.clusterId,
        label: cluster.label,
        sublabel: cluster.contextName,
      })),
    },
  ]
}

export function buildZeaburCredentialSections(
  providers: AgentCredentialOptions['zeaburProviders'],
): CredentialSection[] {
  if (providers.length === 0) return []

  return [
    {
      id: 'zeabur',
      provider: 'zeabur' as const,
      title: 'Zeabur',
      items: providers.map((provider) => ({
        id: provider.zeaburId,
        label: provider.name,
        sublabel: `${provider.kind} · ${provider.zeaburId}`,
      })),
    },
  ]
}

export function buildLinodeCredentialSections(
  accounts: AgentCredentialOptions['linodeAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'linode',
      provider: 'linode' as const,
      title: 'Linode',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.accountId,
      })),
    },
  ]
}

export function buildHetznerCredentialSections(
  accounts: AgentCredentialOptions['hetznerAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'hetzner',
      provider: 'hetzner' as const,
      title: 'Hetzner',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.accountId,
      })),
    },
  ]
}

export function buildTencentCredentialSections(
  accounts: AgentCredentialOptions['tencentAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'tencent',
      provider: 'tencent' as const,
      title: 'Tencent Cloud',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.roleArn,
      })),
    },
  ]
}

export function buildAliyunCredentialSections(
  accounts: AgentCredentialOptions['aliyunAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'aliyun',
      provider: 'aliyun' as const,
      title: 'Alibaba Cloud',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.roleArn,
      })),
    },
  ]
}

export function buildHuaweiCredentialSections(
  accounts: AgentCredentialOptions['huaweiAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'huawei',
      provider: 'huawei' as const,
      title: 'Huawei Cloud',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.domainId,
      })),
    },
  ]
}

export function buildVolcengineCredentialSections(
  accounts: AgentCredentialOptions['volcengineAccounts'],
): CredentialSection[] {
  if (accounts.length === 0) return []

  return [
    {
      id: 'volcengine',
      provider: 'volcengine' as const,
      title: 'Volcengine',
      items: accounts.map((account) => ({
        id: account.accountId,
        label: account.label,
        sublabel: account.roleTrn,
      })),
    },
  ]
}

export function buildDeviceCredentialSections(
  devices: AgentCredentialOptions['devices'],
): CredentialSection[] {
  if (devices.length === 0) return []

  return [
    {
      id: 'device',
      provider: 'device' as const,
      title: 'Devices',
      items: devices.map((device) => ({
        id: device.deviceId,
        label: device.label,
        sublabel: device.platform,
      })),
    },
  ]
}
