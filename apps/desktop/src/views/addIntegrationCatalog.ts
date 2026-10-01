// The "Add connector" catalog's data: which connectors exist, their copy, and
// the search haystacks. Split from AddIntegrationModal so the component file
// stays inside the max-lines limit; category membership and order still come
// from CONNECTOR_CATEGORIES, the shared source of truth.

import { CONNECTOR_CATEGORIES } from '../lib/connectorCategories'

import type { ConnectorCategoryId } from '../lib/connectorCategories'

// Every connector the "Add connector" marketplace can start. Cloud/
// observability/etc. keys map to BindAccountDialog providers; the source-control
// & PM keys (github/gitlab/linear/jira/grafana/sentry) map to their own OAuth
// dialogs — sentry is filed under Observability but is one of these, not a
// BindAccountDialog provider;
// the messaging keys open the workspace settings section that owns their
// install/pairing flows.
export type AddIntegrationKey =
  | 'mongodb'
  | 'aws'
  | 'gcp'
  | 'cloudflare'
  | 'linode'
  | 'hetzner'
  | 'tencent'
  | 'aliyun'
  | 'volcengine'
  | 'huawei'
  | 'azure'
  | 'zeabur'
  | 'onprem-k8s'
  | 'betterstack'
  | 'uptime-kuma'
  | 'grafana'
  | 'sentry'
  | 'posthog'
  | 'tailscale'
  | 'vanta'
  | 'secureframe'
  | 'sonarqube'
  | 'github'
  | 'gitlab'
  | 'linear'
  | 'jira'
  | 'asana'
  | 'notion'
  | 'upstash'
  | 'resend'
  | 'slack'
  | 'discord'
  | 'lark'

export type CatalogItem = {
  key: AddIntegrationKey
  name: string
  description: string
  haystack: string
}
export type CatalogCategory = { id: ConnectorCategoryId; title: string; items: CatalogItem[] }

// Name and blurb per connector. Which category each one lives in — and the
// order both this catalog and the sidebar render — comes from
// CONNECTOR_CATEGORIES, so the two surfaces can't file the same tool
// differently or call the same category by two names.
const ITEM_META: Record<AddIntegrationKey, { name: string; description: string }> = {
  aws: { name: 'AWS', description: 'EC2, S3, EKS, Lambda, IAM, CloudWatch.' },
  gcp: { name: 'GCP', description: 'GKE, Compute, Cloud Run, IAM.' },
  cloudflare: { name: 'Cloudflare', description: 'DNS, Workers, R2, Pages, D1, KV.' },
  linode: { name: 'Linode', description: 'Akamai cloud compute instances.' },
  hetzner: { name: 'Hetzner Cloud', description: 'European VPS & dedicated servers.' },
  tencent: { name: 'Tencent Cloud', description: 'TKE clusters & CVM instances.' },
  aliyun: { name: 'Alibaba Cloud', description: 'ACK clusters & ECS instances.' },
  volcengine: { name: 'Volcengine', description: 'VKE clusters & ECS instances.' },
  huawei: { name: 'Huawei Cloud', description: 'CCE clusters & ECS instances.' },
  azure: { name: 'Microsoft Azure', description: 'AKS clusters & subscription resources.' },
  zeabur: { name: 'Zeabur', description: 'Zeabur projects & services.' },
  'onprem-k8s': {
    name: 'Kubernetes',
    description: 'Connect a Kubernetes cluster through an outbound-only agent.',
  },
  betterstack: { name: 'Better Stack', description: 'Uptime & telemetry monitoring.' },
  'uptime-kuma': { name: 'Uptime Kuma', description: 'Self-hosted uptime monitoring.' },
  grafana: { name: 'Grafana', description: 'Dashboards, alerts & datasources.' },
  sentry: { name: 'Sentry', description: 'Error tracking.' },
  posthog: { name: 'PostHog', description: 'Product analytics & HogQL queries.' },
  mongodb: { name: 'MongoDB', description: 'Governed queries, schemas & changes.' },
  upstash: { name: 'Upstash', description: 'Serverless Redis & Vector databases.' },
  tailscale: { name: 'Tailscale', description: 'Private WireGuard mesh network.' },
  vanta: { name: 'Vanta', description: 'Continuous compliance monitoring.' },
  secureframe: { name: 'Secureframe', description: 'Security & compliance automation.' },
  sonarqube: { name: 'SonarQube', description: 'Code quality & security analysis.' },
  github: { name: 'GitHub', description: 'Repositories, PRs & installations.' },
  gitlab: { name: 'GitLab', description: 'Repositories & merge requests.' },
  linear: { name: 'Linear', description: 'Issues & projects.' },
  jira: { name: 'Jira', description: 'Issues & projects.' },
  asana: { name: 'Asana', description: 'Tasks & projects.' },
  notion: { name: 'Notion', description: 'Pages, databases & docs.' },
  resend: { name: 'Resend', description: 'Send transactional email.' },
  slack: { name: 'Slack', description: 'Chat with the agent from Slack channels.' },
  discord: { name: 'Discord', description: 'Mention the agent in Discord channels.' },
  lark: { name: 'Lark (Feishu)', description: 'Chat with the agent from Lark (Feishu) groups.' },
}

// Alternate names people type instead of the official one. These have to be
// listed rather than computed: no amount of fuzzy matching bridges "amazon" and
// "aws", which share no character sequence at all. Vendor and product aliases
// only — never a capability the connector does not actually have, or the
// catalog starts advertising things it can't do.
const ALIASES: Partial<Record<AddIntegrationKey, string>> = {
  aws: 'amazon amazon web services',
  gcp: 'google',
  azure: 'microsoft msft',
  cloudflare: 'cf',
  tencent: '騰訊 腾讯 qcloud',
  aliyun: '阿里雲 阿里云 alibaba',
  volcengine: '火山引擎 bytedance 字節跳動',
  huawei: '華為雲 华为云 hw',
  'onprem-k8s': 'on-premise self-hosted air-gapped',
  betterstack: 'logtail',
  mongodb: 'mongo',
  tailscale: 'vpn',
  vanta: 'soc2 soc 2',
  secureframe: 'soc2 soc 2',
  sonarqube: 'sonar',
  posthog: 'hogql product analytics',
  github: 'git',
  gitlab: 'git',
  jira: 'atlassian',
  resend: 'smtp',
  lark: '飛書 飞书',
}

function isAddIntegrationKey(key: string): key is AddIntegrationKey {
  return key in ITEM_META
}

export const CATALOG: CatalogCategory[] = CONNECTOR_CATEGORIES.map((category) => ({
  id: category.id,
  title: category.label,
  items: category.catalog.filter(isAddIntegrationKey).map((key) => ({
    key,
    ...ITEM_META[key],
    // Everything a query is matched against, folded once at module load: the
    // category title is in here too, so "messaging" surfaces that whole group.
    haystack:
      `${ITEM_META[key].name} ${ITEM_META[key].description} ${key} ${category.label} ${ALIASES[key] ?? ''}`.toLowerCase(),
  })),
})).filter((category) => category.items.length > 0)
