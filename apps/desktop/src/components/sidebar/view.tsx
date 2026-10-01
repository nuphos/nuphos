import { faServer } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import {
  aliyunSections,
  awsSections,
  cloudflareSections,
  cloudflareZoneSections,
  gcpSections,
  hetznerSections,
  linodeSections,
  tencentSections,
  volcengineSections,
  zeaburSections,
} from './sections-cloud'
import { clusterSections, ecsClusterSections } from './sections-k8s'
import {
  betterStackSections,
  complianceSections,
  databaseSections,
  grafanaSections,
  repositorySections,
  teamSections,
  uptimeKumaSections,
} from './sections-services'
import { isSettingsNavigation } from './types'

import type { Item, Section } from './types'
import type { Scope } from '../../types'

export function sectionsFor(
  scope: Scope,
  active: string,
  grafanaInstance?: { id: string; name: string; url: string } | null,
  repositoryNav?: {
    repoName: string
    tab: 'prs' | 'actions'
  },
  rootIntegrations?: Item[],
  rootIntegrationsLoading?: boolean,
  agentSessionItems?: Item[],
  customResourceSections: Section[] = [],
): Section[] {
  if (scope.kind === 'team' && active.startsWith('github.') && repositoryNav) {
    return repositorySections(repositoryNav.repoName)
  }

  if (
    scope.kind === 'team' &&
    grafanaInstance &&
    (active === 'observability.dashboards' ||
      active === 'observability.alerts' ||
      active === 'observability.datasources')
  ) {
    return grafanaSections(grafanaInstance.name)
  }

  // Connector-settings drill-downs (AWS roles, GCP service accounts, Cloudflare
  // IAM) are reached from the Connectors page — keep the team sidebar (with
  // Connectors highlighted) instead of the provider's infra nav.
  if (isSettingsNavigation(scope, active)) {
    return teamSections(rootIntegrations, rootIntegrationsLoading, agentSessionItems)
  }

  switch (scope.kind) {
    case 'team':
      return teamSections(rootIntegrations, rootIntegrationsLoading, agentSessionItems)
    case 'aws-account':
      return awsSections()
    case 'gcp-project':
      return gcpSections()
    case 'cloudflare-account':
      return cloudflareSections()
    case 'linode-account':
      return linodeSections()
    case 'hetzner-account':
      return hetznerSections()
    case 'tencent-account':
      return tencentSections()
    case 'aliyun-account':
      return aliyunSections()
    case 'volcengine-account':
      return volcengineSections()
    case 'azure-subscription':
      // The apps drill-down is a settings-style navigation (isSettingsNavigation
      // returns teamSections above); this case keeps the switch exhaustive and
      // mirrors that — the team sidebar with Connectors highlighted.
      return teamSections(rootIntegrations, rootIntegrationsLoading, agentSessionItems)
    case 'betterstack-integration':
      return betterStackSections()
    case 'uptime-kuma-instance':
      return uptimeKumaSections()
    case 'database-connection':
      return databaseSections()
    case 'compliance-integration':
      return complianceSections(scope.provider)
    case 'tailscale-client':
      return [
        {
          title: 'Network',
          items: [
            {
              key: 'tailscale.devices',
              label: 'Devices',
              iconNode: (
                <FontAwesomeIcon
                  icon={faServer}
                  className="w-3.5 h-3.5 flex-shrink-0 text-tertiary"
                />
              ),
              enabled: true,
            },
          ],
        },
      ]
    case 'zeabur-provider':
      return zeaburSections()
    case 'cloudflare-zone':
      return cloudflareZoneSections()
    case 'cluster':
      return clusterSections(customResourceSections)
    case 'aws-ecs-cluster':
      return ecsClusterSections()
  }
}

/**
 * Identity + hierarchy depth of the section list currently shown in the
 * sidebar. The key changes exactly when `sectionsFor` would render a different
 * list (so the slide fires on real navigation, not on same-scope item picks),
 * and the level drives the slide direction: deeper = slide forward.
 */
export function sidebarView(
  scope: Scope,
  active: string,
  grafanaInstance?: { id: string; name: string; url: string } | null,
  repositoryNav?: { repoName: string; tab: 'prs' | 'actions' },
): { key: string; level: number } {
  if (scope.kind === 'team' && active.startsWith('github.') && repositoryNav) {
    return { key: `repo:${repositoryNav.repoName}`, level: 1 }
  }
  if (
    scope.kind === 'team' &&
    grafanaInstance &&
    (active === 'observability.dashboards' ||
      active === 'observability.alerts' ||
      active === 'observability.datasources')
  ) {
    return { key: `grafana:${grafanaInstance.id}`, level: 1 }
  }
  // Connector-settings drill-downs keep the team section list (see sectionsFor),
  // so they must share the team view key — no slide when entering/leaving them.
  if (
    (scope.kind === 'aws-account' ||
      scope.kind === 'gcp-project' ||
      scope.kind === 'cloudflare-account' ||
      scope.kind === 'azure-subscription') &&
    isSettingsNavigation(scope, active)
  ) {
    return { key: `team:${scope.teamId}`, level: 0 }
  }
  switch (scope.kind) {
    case 'team':
      return { key: `team:${scope.teamId}`, level: 0 }
    case 'aws-account':
      return { key: `aws:${scope.accountId}`, level: 1 }
    case 'gcp-project':
      return { key: `gcp:${scope.projectId}`, level: 1 }
    case 'cloudflare-account':
      return { key: `cloudflare:${scope.accountId}`, level: 1 }
    case 'linode-account':
      return { key: `linode:${scope.accountId}`, level: 1 }
    case 'hetzner-account':
      return { key: `hetzner:${scope.accountId}`, level: 1 }
    case 'tencent-account':
      return { key: `tencent:${scope.accountId}`, level: 1 }
    case 'aliyun-account':
      return { key: `aliyun:${scope.accountId}`, level: 1 }
    case 'volcengine-account':
      return { key: `volcengine:${scope.accountId}`, level: 1 }
    case 'azure-subscription':
      // Settings-nav (handled above); keep the team key so entering/leaving the
      // apps drill-down doesn't slide.
      return { key: `team:${scope.teamId}`, level: 0 }
    case 'betterstack-integration':
      return { key: `betterstack:${scope.integrationId}`, level: 1 }
    case 'uptime-kuma-instance':
      return { key: `uptime-kuma:${scope.instanceId}`, level: 1 }
    case 'database-connection':
      return { key: `database:${scope.connectionId}`, level: 1 }
    case 'compliance-integration':
      return { key: `compliance:${scope.provider}:${scope.integrationId}`, level: 1 }
    case 'tailscale-client':
      return { key: `tailscale:${scope.clientId}`, level: 1 }
    case 'zeabur-provider':
      return { key: `zeabur:${scope.zeaburId}`, level: 1 }
    case 'cloudflare-zone':
      return { key: `cloudflare-zone:${scope.zoneId}`, level: 2 }
    case 'cluster':
      return {
        key: `cluster:${scope.parentId}:${scope.clusterName}:${scope.region}`,
        level: 2,
      }
    case 'aws-ecs-cluster':
      return { key: `ecs:${scope.accountId}:${scope.clusterName}`, level: 2 }
  }
}
