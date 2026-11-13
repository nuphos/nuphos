import { api } from '../api'
import { t } from '../i18n/index.ts'

import type { BindingAccess } from '../types'

export type BindingAccessProvider =
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'upstash'
  | 'posthog'
  | 'trello'
  | 'plaud'
  | 'tencent'
  | 'aliyun'
  | 'volcengine'
  | 'huawei'
  | 'betterstack'
  | 'cloudflare'
  | 'github'
  | 'gitlab'
  | 'grafana'
  | 'linode'
  | 'hetzner'
  | 'tailscale'
  | 'linear'
  | 'jira'
  | 'asana'
  | 'sentry'
  | 'notion'
  | 'resend'
  | 'sonarqube'
  | 'vanta'
  | 'secureframe'
  | 'uptime-kuma'
  | 'onprem'

type ProviderConfig = {
  /** The noun shown to the user for the thing being scoped. */
  resourceLabel: string
  load: (teamId: string, id: string, secondaryId?: string) => Promise<BindingAccess>
  save: (
    teamId: string,
    id: string,
    input: Pick<BindingAccess, 'memberAllowList'>,
    secondaryId?: string,
  ) => Promise<BindingAccess>
}

/** A binding whose member list is edited through the generic access routes. */
function generic(collection: string, resourceLabel: string): ProviderConfig {
  return {
    resourceLabel,
    load: (teamId, id) => api.atlasGetBindingAccess(teamId, collection, id),
    save: (teamId, id, input) => api.atlasUpdateBindingAccess(teamId, collection, id, input),
  }
}

export const PROVIDERS: Record<BindingAccessProvider, ProviderConfig> = {
  aws: {
    resourceLabel: t('role'),
    load: (teamId, id, roleId) => api.atlasGetAwsAccountAccess(teamId, id, roleId),
    save: (teamId, id, input, roleId) => api.atlasUpdateAwsAccountAccess(teamId, id, input, roleId),
  },
  gcp: {
    resourceLabel: t('service account'),
    load: (teamId, id, bindingId) => api.atlasGetGcpProjectAccess(teamId, id, bindingId),
    save: (teamId, id, input, bindingId) =>
      api.atlasUpdateGcpProjectAccess(teamId, id, input, bindingId),
  },
  azure: {
    resourceLabel: t('app'),
    load: (teamId, id) => api.atlasGetAzureAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateAzureAccountAccess(teamId, id, input),
  },
  upstash: {
    resourceLabel: t('Upstash account'),
    load: (teamId, id) => api.atlasGetUpstashAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateUpstashAccountAccess(teamId, id, input),
  },
  trello: {
    resourceLabel: t('Trello account'),
    load: (teamId, id) => api.atlasGetTrelloAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateTrelloAccess(teamId, id, input),
  },
  posthog: {
    resourceLabel: t('PostHog integration'),
    load: (teamId, id) => api.atlasGetPosthogIntegrationAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdatePosthogIntegrationAccess(teamId, id, input),
  },
  plaud: {
    resourceLabel: t('Plaud account'),
    load: (teamId, id) => api.atlasGetPlaudAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdatePlaudAccountAccess(teamId, id, input),
  },
  tencent: {
    resourceLabel: t('Tencent Cloud binding'),
    load: (teamId, id) => api.atlasGetTencentAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateTencentAccountAccess(teamId, id, input),
  },
  aliyun: {
    resourceLabel: t('Alibaba Cloud binding'),
    load: (teamId, id) => api.atlasGetAliyunAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateAliyunAccountAccess(teamId, id, input),
  },
  volcengine: {
    resourceLabel: t('Volcengine binding'),
    load: (teamId, id) => api.atlasGetVolcengineAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateVolcengineAccountAccess(teamId, id, input),
  },
  huawei: {
    resourceLabel: t('Huawei Cloud binding'),
    load: (teamId, id) => api.atlasGetHuaweiAccountAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateHuaweiAccountAccess(teamId, id, input),
  },
  betterstack: {
    resourceLabel: t('Better Stack integration'),
    load: (teamId, id) => api.atlasGetBetterStackIntegrationAccess(teamId, id),
    save: (teamId, id, input) => api.atlasUpdateBetterStackIntegrationAccess(teamId, id, input),
  },
  cloudflare: generic('cloudflare-accounts', t('Cloudflare account')),
  github: generic('github-installations', t('GitHub installation')),
  gitlab: generic('gitlab-bindings', t('GitLab account')),
  grafana: generic('grafana-instances', t('Grafana instance')),
  linode: generic('linode-accounts', t('Linode account')),
  hetzner: generic('hetzner-accounts', t('Hetzner account')),
  tailscale: generic('tailscale-clients', t('Tailscale client')),
  linear: generic('linear-workspaces', t('Linear workspace')),
  jira: generic('jira-sites', t('Jira site')),
  asana: generic('asana-accounts', t('Asana account')),
  sentry: generic('sentry-accounts', t('Sentry account')),
  notion: generic('notion-integrations', t('Notion integration')),
  resend: generic('resend-integrations', t('Resend integration')),
  sonarqube: generic('sonarqube-integrations', t('SonarQube integration')),
  vanta: generic('vanta-integrations', t('Vanta integration')),
  secureframe: generic('secureframe-integrations', t('Secureframe integration')),
  'uptime-kuma': generic('uptime-kuma-instances', t('Uptime Kuma instance')),
  onprem: generic('onprem-clusters', t('Kubernetes cluster')),
}
