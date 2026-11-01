import { api } from '../../api'
import { t } from '../../i18n/index.ts'

import type { IntegrationPlatformRow, OpenConnectorInfo } from './team-home-bind'
import type {
  AliyunAccount,
  AzureAccount,
  HuaweiAccount,
  NotionIntegration,
  ResendIntegration,
  SecureframeIntegration,
  SonarqubeIntegration,
  TencentAccount,
  UpstashAccount,
  VantaIntegration,
  VolcengineAccount,
} from '../../types'

export function buildSaasConnectorRows({
  teamId,
  vantaIntegrations,
  secureframeIntegrations,
  sonarqubeIntegrations,
  notionIntegrations,
  upstashAccounts,
  resendIntegrations,
  tencentAccounts,
  aliyunAccounts,
  volcengineAccounts,
  huaweiAccounts,
  azureAccounts,
  onOpenConnectorInfo,
}: {
  teamId: string
  vantaIntegrations: VantaIntegration[]
  secureframeIntegrations: SecureframeIntegration[]
  sonarqubeIntegrations: SonarqubeIntegration[]
  notionIntegrations: NotionIntegration[]
  upstashAccounts: UpstashAccount[]
  resendIntegrations: ResendIntegration[]
  tencentAccounts: TencentAccount[]
  aliyunAccounts: AliyunAccount[]
  volcengineAccounts: VolcengineAccount[]
  huaweiAccounts: HuaweiAccount[]
  azureAccounts: AzureAccount[]
  onOpenConnectorInfo: OpenConnectorInfo
}): IntegrationPlatformRow[] {
  // Azure groups by subscription — the analog of an AWS account / GCP project.
  // One subscription can carry several app bindings (operational + a break-glass
  // permission-admin one), so collapse them into one row per subscription.
  const azureSubscriptionRows = Array.from(
    azureAccounts.reduce((map, app) => {
      const existing = map.get(app.subscriptionId)

      if (existing) {
        existing.apps.push(app)
      } else {
        map.set(app.subscriptionId, { subscriptionId: app.subscriptionId, apps: [app] })
      }

      return map
    }, new Map<string, { subscriptionId: string; apps: AzureAccount[] }>()),
  ).map(([, subscription]) => subscription)

  return [
    ...vantaIntegrations.map((integration) => ({
      key: `vanta:${integration.id}`,
      provider: 'vanta' as const,
      account: integration.orgDisplayName || integration.label,
      principal: t('Client credentials'),
      status: t('Vanta integration'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'vanta',
          connectorId: integration.id,
          name: integration.orgDisplayName || integration.label,
        }),
      onDelete: () => api.atlasUnbindVantaIntegration(teamId, integration.id),
    })),
    ...secureframeIntegrations.map((integration) => ({
      key: `secureframe:${integration.id}`,
      provider: 'secureframe' as const,
      account: integration.label,
      principal: t('API key · {region}', { region: integration.region.toUpperCase() }),
      status: t('Secureframe integration'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'secureframe',
          connectorId: integration.id,
          name: integration.label,
        }),
      onDelete: () => api.atlasUnbindSecureframeIntegration(teamId, integration.id),
    })),
    ...sonarqubeIntegrations.map((integration) => ({
      key: `sonarqube:${integration.id}`,
      provider: 'sonarqube' as const,
      account: integration.label,
      principal: integration.baseUrl,
      status: integration.version ? `SonarQube ${integration.version}` : t('SonarQube instance'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'sonarqube',
          connectorId: integration.id,
          name: integration.label,
        }),
      onDelete: () => api.atlasUnbindSonarqubeIntegration(teamId, integration.id),
    })),
    ...notionIntegrations.map((integration) => ({
      key: `notion:${integration.id}`,
      provider: 'notion' as const,
      account: integration.label,
      principal: integration.workspaceName || t('Notion workspace'),
      status: t('Notion integration'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'notion',
          connectorId: integration.id,
          name: integration.label,
        }),
      onDelete: () => api.atlasUnbindNotionIntegration(teamId, integration.id),
    })),
    ...upstashAccounts.map((account) => ({
      key: `upstash:${account.id}`,
      provider: 'upstash' as const,
      account: account.label,
      principal: account.email,
      status: t('Upstash account'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'upstash',
          connectorId: account.id,
          name: account.label,
        }),
      onDelete: () => api.atlasUnbindUpstashAccount(teamId, account.id),
    })),
    ...resendIntegrations.map((integration) => ({
      key: `resend:${integration.id}`,
      provider: 'resend' as const,
      account: integration.label,
      principal:
        integration.permission === 'sending_access' ? t('Sending access') : t('Full access'),
      status: t('Resend integration'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'resend',
          connectorId: integration.id,
          name: integration.label,
        }),
      onDelete: () => api.atlasUnbindResendIntegration(teamId, integration.id),
    })),
    ...tencentAccounts.map((account) => ({
      key: `tencent:${account.id}`,
      provider: 'tencent' as const,
      account: account.label,
      principal: t('Role · {arn}', { arn: account.roleArn }),
      status:
        account.site === 'international'
          ? t('Tencent Cloud · International')
          : t('Tencent Cloud · China'),
      onAction: () =>
        onOpenConnectorInfo({ provider: 'tencent', connectorId: account.id, name: account.label }),
      onDelete: () => api.atlasUnbindTencentAccount(teamId, account.id),
    })),
    ...aliyunAccounts.map((account) => ({
      key: `aliyun:${account.id}`,
      provider: 'aliyun' as const,
      account: account.label,
      principal: t('Role · {arn}', { arn: account.roleArn }),
      status:
        account.site === 'international' ? t('Alibaba Cloud · International') : t('Aliyun · China'),
      onAction: () =>
        onOpenConnectorInfo({ provider: 'aliyun', connectorId: account.id, name: account.label }),
      onDelete: () => api.atlasUnbindAliyunAccount(teamId, account.id),
    })),
    ...volcengineAccounts.map((account) => ({
      key: `volcengine:${account.id}`,
      provider: 'volcengine' as const,
      account: account.label,
      principal: t('Role · {arn}', { arn: account.roleTrn }),
      status: t('Volcengine account'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'volcengine',
          connectorId: account.id,
          name: account.label,
        }),
      onDelete: () => api.atlasUnbindVolcengineAccount(teamId, account.id),
    })),
    ...huaweiAccounts.map((account) => ({
      key: `huawei:${account.id}`,
      provider: 'huawei' as const,
      account: account.label,
      principal: t('Identity provider · {id}', { id: account.idpId }),
      status: t('Huawei Cloud account'),
      onAction: () =>
        onOpenConnectorInfo({ provider: 'huawei', connectorId: account.id, name: account.label }),
      onDelete: () => api.atlasUnbindHuaweiAccount(teamId, account.id),
    })),
    ...azureSubscriptionRows.map((subscription) => ({
      key: `azure:${subscription.subscriptionId}`,
      provider: 'azure' as const,
      account: subscription.subscriptionId,
      principal:
        subscription.apps.length === 1
          ? subscription.apps[0].label
          : t('{n} apps', { n: subscription.apps.length }),
      status: t('Azure subscription'),
      onAction: () =>
        onOpenConnectorInfo({
          provider: 'azure',
          connectorId: subscription.subscriptionId,
          name: subscription.subscriptionId,
        }),
      onDelete: async () => {
        for (const app of subscription.apps) {
          await api.atlasUnbindAzureAccount(teamId, app.id)
        }
      },
    })),
  ]
}
