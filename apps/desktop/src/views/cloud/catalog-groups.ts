import { t } from '../../i18n/index.ts'

import type { ConnectorCategoryId } from '../../lib/connectorCategories.ts'
import type { AddIntegrationKey, CatalogCategory, CatalogItem } from '../addIntegrationCatalog'

export type CatalogGroupId =
  'productivity' | 'communication' | 'code' | 'cloud' | 'monitoring' | 'data'

export type CatalogGroup = { id: CatalogGroupId; title: string; items: CatalogItem[] }

// The Connectors page groups by what people use a connector for, with fewer
// and broader groups than the sidebar, which keeps the finer categories.
const GROUPS: { id: CatalogGroupId; title: string; categories: ConnectorCategoryId[] }[] = [
  { id: 'productivity', title: t('Productivity'), categories: ['document', 'project-management'] },
  { id: 'communication', title: t('Communication'), categories: ['messaging', 'email'] },
  { id: 'code', title: t('Code'), categories: ['source-control'] },
  { id: 'cloud', title: t('Cloud & infrastructure'), categories: ['infrastructure', 'networking'] },
  {
    id: 'monitoring',
    title: t('Monitoring & security'),
    categories: ['observability', 'compliance'],
  },
  { id: 'data', title: t('Data'), categories: ['databases'] },
]

// Connectors whose use fits another group better than their category's.
const MOVED: Partial<Record<AddIntegrationKey, CatalogGroupId>> = {
  sonarqube: 'code',
  posthog: 'data',
}

// Within a group, the connectors most teams reach for come first, so the rows a
// group shows before View all are the likeliest picks. Unlisted ones follow.
const POPULAR: AddIntegrationKey[] = [
  'notion',
  'linear',
  'jira',
  'asana',
  'trello',
  'plaud',
  'slack',
  'discord',
  'lark',
  'resend',
  'github',
  'gitlab',
  'sonarqube',
  'aws',
  'gcp',
  'azure',
  'cloudflare',
  'onprem-k8s',
  'zeabur',
  'aliyun',
  'tencent',
  'hetzner',
  'linode',
  'huawei',
  'volcengine',
  'tailscale',
  'instabox',
  'sentry',
  'grafana',
  'betterstack',
  'uptime-kuma',
  'vanta',
  'secureframe',
  'posthog',
  'mongodb',
  'upstash',
]

function rank(item: CatalogItem): number {
  const index = POPULAR.indexOf(item.key)

  return index === -1 ? POPULAR.length : index
}

function groupOf(category: ConnectorCategoryId, item: CatalogItem): CatalogGroupId | undefined {
  return MOVED[item.key] ?? GROUPS.find((group) => group.categories.includes(category))?.id
}

/** The page's groups in order, each with its connectors by popularity; empty groups are left out. */
export function groupCatalog(categories: CatalogCategory[]): CatalogGroup[] {
  return GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    items: categories
      .flatMap((category) =>
        category.items.filter((item) => groupOf(category.id, item) === group.id),
      )
      .sort((a, b) => rank(a) - rank(b)),
  })).filter((group) => group.items.length > 0)
}
