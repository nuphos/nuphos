import { Cloud, FolderTree, Server, Users } from 'lucide-react'

import { isBarePagePath, navigationFromAppPath } from '../lib/appRoutes'
import { isSettingsNavigation } from '../lib/connectorScopeCrumb'
import {
  TEAM_SIDEBAR_NAV_ITEMS,
  TEAM_WORKSPACE_NAV_ITEMS,
  canonicalTeamOverviewKey,
  isTeamOverviewKey,
  isTeamWorkspaceKey,
} from '../lib/teamOverviewNav'

import {
  awsAccountNavItems,
  azureSubscriptionNavItems,
  cloudflareAccountNavItems,
  cloudflareZoneNavItems,
  gcpProjectNavItems,
} from './nav/cloudAccountNavItems'
import { clusterScopeNavItems } from './nav/clusterNavItems'
import {
  aliyunAccountNavItems,
  awsEcsClusterNavItems,
  betterstackIntegrationNavItems,
  complianceIntegrationNavItems,
  databaseConnectionNavItems,
  hetznerAccountNavItems,
  linodeAccountNavItems,
  tailscaleClientNavItems,
  tencentAccountNavItems,
  uptimeKumaInstanceNavItems,
  volcengineAccountNavItems,
  zeaburProviderNavItems,
} from './nav/providerNavItems'

import type { PageLocation } from '../lib/appRoutes'
import type { Scope } from '../types'
import type { DetailTarget } from '../views/DetailView'
import type { NavItemMeta } from './nav/types'

export type { NavItemMeta } from './nav/types'

export function activeNavItemsFor(scope: Scope, active: string): NavItemMeta[] {
  if (scope.kind === 'aws-account') return awsAccountNavItems()
  if (scope.kind === 'gcp-project') return gcpProjectNavItems()
  if (scope.kind === 'azure-subscription') return azureSubscriptionNavItems()
  if (scope.kind === 'cloudflare-account') return cloudflareAccountNavItems()
  if (scope.kind === 'linode-account') return linodeAccountNavItems()
  if (scope.kind === 'hetzner-account') return hetznerAccountNavItems()
  if (scope.kind === 'tencent-account') return tencentAccountNavItems()
  if (scope.kind === 'aliyun-account') return aliyunAccountNavItems()
  if (scope.kind === 'volcengine-account') return volcengineAccountNavItems()
  if (scope.kind === 'betterstack-integration') return betterstackIntegrationNavItems()
  if (scope.kind === 'uptime-kuma-instance') return uptimeKumaInstanceNavItems()
  if (scope.kind === 'database-connection') return databaseConnectionNavItems()
  if (scope.kind === 'compliance-integration') return complianceIntegrationNavItems(scope)
  if (scope.kind === 'tailscale-client') return tailscaleClientNavItems()
  if (scope.kind === 'zeabur-provider') return zeaburProviderNavItems()
  if (scope.kind === 'cloudflare-zone') return cloudflareZoneNavItems()
  if (scope.kind === 'aws-ecs-cluster') return awsEcsClusterNavItems()
  if (scope.kind === 'cluster') return clusterScopeNavItems(active)
  // A team page's picker offers the rows of the surface it opens from: the
  // sidebar for chat and management pages, New Tab for workspace pages.
  // Members has no row anywhere — it is the landing page for agent-generated
  // /settings/members links — so it is appended under its own group.
  if (scope.kind === 'team' && (isTeamOverviewKey(active) || active === 'team.members')) {
    const siblings = isTeamWorkspaceKey(active) ? TEAM_WORKSPACE_NAV_ITEMS : TEAM_SIDEBAR_NAV_ITEMS
    const overview: NavItemMeta[] = siblings.map((item) => ({
      key: item.key,
      label: item.label,
      icon: <item.icon className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    }))

    if (active === 'team.members') {
      overview.push({
        key: 'team.members',
        label: 'Members',
        group: 'Settings',
        icon: <Users className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      })
    }

    return overview
  }
  if (isSettingsNavigation(scope, active)) {
    return [
      {
        key: 'team.members',
        label: 'Members',
        group: 'Settings',
        icon: <Users className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
      {
        key: 'team.integrations',
        label: 'Connectors',
        group: 'Settings',
        icon: <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
    ]
  }

  return []
}

export function activeNavItemFor(scope: Scope, active: string): NavItemMeta | undefined {
  const key = canonicalTeamOverviewKey(active)

  return activeNavItemsFor(scope, active).find((item) => item.key === key)
}

export function k8sResourceIcon(kind: DetailTarget['kind']): React.ReactNode {
  switch (kind) {
    case 'Node':
      return <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
    case 'Service':
    case 'Ingress':
    case 'EndpointSlice':
      return <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
    // Everything else is a generic workload/config resource.
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'Pod':
    case 'ReplicaSet':
    case 'Job':
    case 'CronJob':
    case 'ConfigMap':
    case 'Secret':
    case 'StorageClass':
    case 'NetworkPolicy':
    case 'ServiceAccount':
    case 'Role':
    case 'RoleBinding':
    case 'ClusterRole':
    case 'ClusterRoleBinding':
    case 'PersistentVolume':
    case 'PersistentVolumeClaim':
    case 'HelmRelease':
    case 'CustomResourceDefinition':
    case 'CustomResource':
    default:
      return <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />
  }
}

// User is in the Observability path (drilling Team > Observability > Account >
// Dashboard) if the current active key belongs to that flow. Used to preserve
// the path when switching between scopes via the breadcrumb or account picker.
export function isObservabilityActive(active: string): boolean {
  return (
    active === 'team.observability' ||
    active === 'observability.dashboards' ||
    active === 'observability.alerts' ||
    active === 'observability.datasources'
  )
}

export function titleFromLocation(location: PageLocation): string {
  const segment = location.pathname.split('/').findLast(Boolean)

  if (!segment) return 'Nuphos'

  return decodeURIComponent(segment)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * A team Overview page at its bare address is already a permanent sidebar row,
 * so pinning it to Favorites would only duplicate a row that never goes away.
 * Drill-downs, chats, and filtered views of the same page stay pinnable.
 */
export function isPermanentSidebarPage(appHref: string): boolean {
  const navigation = navigationFromAppPath(appHref)

  if (!navigation) return false

  return (
    navigation.active === 'team.new-tab' ||
    (navigation.active !== 'team.browser' &&
      isTeamOverviewKey(navigation.active) &&
      isBarePagePath(appHref))
  )
}
