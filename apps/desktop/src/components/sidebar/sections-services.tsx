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

import { t } from '../../i18n'
import { groupByConnectorCategory } from '../../lib/connectorCategories'
import { TEAM_SIDEBAR_NAV_ITEMS } from '../../lib/teamOverviewNav'

import type { Item, Section } from './types'

export function betterStackSections(): Section[] {
  return [
    {
      title: t('Uptime'),
      items: [
        {
          key: 'betterstack.monitors',
          label: t('Monitors'),
          iconNode: <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'betterstack.incidents',
          label: t('Incidents'),
          iconNode: (
            <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5 text-tertiary" />
          ),
          enabled: true,
        },
      ],
    },
    {
      title: t('Telemetry'),
      items: [
        {
          key: 'betterstack.sources',
          label: t('Sources'),
          iconNode: <FontAwesomeIcon icon={faDatabase} className="w-3.5 h-3.5 text-tertiary" />,
          enabled: true,
        },
        {
          key: 'betterstack.dashboards',
          label: t('Dashboards'),
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
      title: t('Data'),
      items: [
        { key: 'database.overview', label: t('Overview'), icon: Compass, enabled: true },
        { key: 'database.collections', label: t('Collections'), icon: Layers, enabled: true },
        { key: 'database.query', label: t('Query'), icon: Terminal, enabled: true },
      ],
    },
    {
      title: t('Operations'),
      items: [
        { key: 'database.changes', label: t('Changes'), icon: GitPullRequest, enabled: true },
        { key: 'database.monitoring', label: t('Monitoring'), icon: ChartLine, enabled: true },
      ],
    },
    {
      title: t('Governance'),
      items: [
        { key: 'database.access', label: t('Access'), icon: ShieldCheck, enabled: true },
        { key: 'database.audit', label: t('Audit'), icon: Scroll, enabled: true },
        { key: 'database.settings', label: t('Settings'), icon: Settings2, enabled: true },
      ],
    },
  ]
}

export function uptimeKumaSections(): Section[] {
  return [
    {
      title: t('Uptime'),
      items: [
        {
          key: 'uptime-kuma.monitors',
          label: t('Monitors'),
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
      items: [
        { key: 'compliance.tests', label: t('Failed Tests'), icon: ShieldAlert, enabled: true },
      ],
    },
  ]
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
    ...(agentSessionItems.length > 0 ? [{ title: 'Agents', items: agentSessionItems }] : []),
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
          label: t('Dashboards'),
          icon: LayoutDashboard,
          enabled: true,
        },
        {
          key: 'observability.alerts',
          label: t('Alerts'),
          icon: Bell,
          enabled: true,
        },
        {
          key: 'observability.datasources',
          label: t('Datasources'),
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
          label: t('PRs'),
          icon: GitPullRequest,
          enabled: true,
        },
        {
          key: 'github.actions',
          label: t('Workflows'),
          icon: Workflow,
          enabled: true,
        },
      ],
    },
  ]
}
