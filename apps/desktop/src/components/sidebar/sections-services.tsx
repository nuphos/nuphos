import {
  faDatabase,
  faGaugeHigh,
  faTableColumns,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  Bell,
  ChartLine,
  Compass,
  Database,
  GitPullRequest,
  Layers,
  LayoutDashboard,
  Scroll,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Workflow,
} from 'lucide-react'

import { groupByConnectorCategory } from '../../lib/connectorCategories'
import { TEAM_SIDEBAR_NAV_ITEMS } from '../../lib/teamOverviewNav'

import type { Item, Section } from './types'

export function betterStackSections(): Section[] {
  return [
    {
      title: 'Uptime',
      items: [
        {
          key: 'betterstack.monitors',
          label: 'Monitors',
          iconNode: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'betterstack.incidents',
          label: 'Incidents',
          iconNode: (
            <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5 text-tertiary" />
          ),
          enabled: true,
        },
      ],
    },
    {
      title: 'Telemetry',
      items: [
        {
          key: 'betterstack.sources',
          label: 'Sources',
          iconNode: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'betterstack.dashboards',
          label: 'Dashboards',
          iconNode: <FontAwesomeIcon icon={faTableColumns} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
      ],
    },
  ]
}

export function databaseSections(): Section[] {
  return [
    {
      title: 'Data',
      items: [
        { key: 'database.overview', label: 'Overview', icon: Compass, enabled: true },
        { key: 'database.collections', label: 'Collections', icon: Layers, enabled: true },
        { key: 'database.query', label: 'Query', icon: Terminal, enabled: true },
      ],
    },
    {
      title: 'Operations',
      items: [
        { key: 'database.changes', label: 'Changes', icon: GitPullRequest, enabled: true },
        { key: 'database.monitoring', label: 'Monitoring', icon: ChartLine, enabled: true },
      ],
    },
    {
      title: 'Governance',
      items: [
        { key: 'database.access', label: 'Access', icon: ShieldCheck, enabled: true },
        { key: 'database.audit', label: 'Audit', icon: Scroll, enabled: true },
        { key: 'database.settings', label: 'Settings', icon: Settings2, enabled: true },
      ],
    },
  ]
}

export function uptimeKumaSections(): Section[] {
  return [
    {
      title: 'Uptime',
      items: [
        {
          key: 'uptime-kuma.monitors',
          label: 'Monitors',
          iconNode: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
      ],
    },
  ]
}

export function complianceSections(provider: 'secureframe' | 'vanta'): Section[] {
  return [
    {
      title: provider === 'vanta' ? 'Vanta' : 'Secureframe',
      items: [{ key: 'compliance.tests', label: 'Failed Tests', icon: ShieldAlert, enabled: true }],
    },
  ]
}

/**
 * Sessions the viewer joined but does not own. Its own function because the
 * favorites resolver needs the same section to look a pinned row up among the
 * live ones — a pin that cannot find itself there renders a static icon instead
 * of the live runtime one.
 */
export function sharedChatSection(sharedChatItems: Item[]): Section[] {
  return sharedChatItems.length > 0 ? [{ title: 'Shared', items: sharedChatItems }] : []
}

/**
 * The chat groups in team view: what the viewer pinned, then the sessions they
 * joined, both above their own Chats — which drops the pinned rows so no chat
 * is listed twice. An empty group contributes no section at all.
 */
export function withChatSections(
  sections: Section[],
  pinnedChatItems: Item[],
  sharedChatItems: Item[],
  isPinned: (item: Item) => unknown,
): Section[] {
  const result = sections.flatMap((section) => {
    if (section.title !== 'Chats') return [section]
    const items = section.items.filter((item) => !isPinned(item))

    return items.length > 0 ? [{ ...section, items }] : []
  })
  const chatsIndex = result.findIndex((section) => section.title === 'Chats')

  result.splice(
    chatsIndex === -1 ? 1 : chatsIndex,
    0,
    ...(pinnedChatItems.length > 0 ? [{ title: 'Pinned', items: pinnedChatItems }] : []),
    ...sharedChatSection(sharedChatItems),
  )

  return result
}

export function teamSections(
  rootIntegrations: Item[] = [],
  rootIntegrationsLoading = false,
  agentSessionItems: Item[] = [],
): Section[] {
  const connectorGroups = groupByConnectorCategory(rootIntegrations)
  // While the integrations load there is nothing to group yet; a title-less
  // section carries the skeleton so the nav doesn't jump on arrival. It has to
  // stay title-less: every connector group folds at rest, so borrowing one's
  // title would render the skeleton inside a collapsed group and hide it.
  const loadingPlaceholder: Section[] =
    rootIntegrationsLoading && connectorGroups.length === 0 ? [{ items: [], loading: true }] : []

  return [
    {
      items: TEAM_SIDEBAR_NAV_ITEMS.map((item) => ({
        key: item.key,
        label: item.label,
        icon: item.icon,
        enabled: true,
      })),
    },
    ...(agentSessionItems.length > 0 ? [{ title: 'Chats', items: agentSessionItems }] : []),
    ...loadingPlaceholder,
    ...connectorGroups.map(({ category, items }) => ({
      title: category.label,
      items,
    })),
  ]
}

export function grafanaSections(instanceName: string): Section[] {
  return [
    {
      title: instanceName,
      items: [
        {
          key: 'observability.dashboards',
          label: 'Dashboards',
          icon: LayoutDashboard,
          enabled: true,
        },
        {
          key: 'observability.alerts',
          label: 'Alerts',
          icon: Bell,
          enabled: true,
        },
        {
          key: 'observability.datasources',
          label: 'Datasources',
          icon: Database,
          enabled: true,
        },
      ],
    },
  ]
}

export function repositorySections(repoName: string): Section[] {
  return [
    {
      title: repoName,
      items: [
        {
          key: 'github.prs',
          label: 'PRs',
          icon: GitPullRequest,
          enabled: true,
        },
        {
          key: 'github.actions',
          label: 'Workflows',
          icon: Workflow,
          enabled: true,
        },
      ],
    },
  ]
}
