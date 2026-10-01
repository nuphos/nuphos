import { Bell, Container, Database, LayoutDashboard, Server } from 'lucide-react'

import { activeNavItemsFor } from '../../../app/navItems'
import { isSettingsNavigation } from '../../../lib/connectorScopeCrumb'

import type { BreadcrumbContext } from './breadcrumbContext'
import type { BreadcrumbSegment } from '../../../components/Toolbar'
import type { Scope } from '../../../types'

export function pushClusterCrumbs(ctx: BreadcrumbContext, out: BreadcrumbSegment[]): void {
  const {
    scope,
    active,
    updateActiveTab,
    enterScope,
    grafanaInstance,
    dashboardTarget,
    traceDatasourceTarget,
    logDatasourceTarget,
    grafanaInstancesByTeam,
    onSidebarSelect,
  } = ctx

  if (scope.kind === 'cluster') {
    // An on-prem binding is both the connector and the Kubernetes cluster.
    // Its connector crumb already names the cluster, so inserting a synthetic
    // "Kubernetes" account level would duplicate the entity and produce a
    // back target that does not exist in the sidebar.
    if (scope.parentKind === 'onprem-cluster') return

    const parentScope: Scope =
      scope.parentKind === 'aws-account'
        ? {
            kind: 'aws-account',
            teamId: scope.teamId,
            accountId: scope.parentId,
            roleId: scope.roleId,
          }
        : scope.parentKind === 'linode-account'
          ? {
              kind: 'linode-account',
              teamId: scope.teamId,
              accountId: scope.parentId,
            }
          : scope.parentKind === 'tencent-account'
            ? {
                kind: 'tencent-account',
                teamId: scope.teamId,
                accountId: scope.parentId,
              }
            : scope.parentKind === 'aliyun-account'
              ? {
                  kind: 'aliyun-account',
                  teamId: scope.teamId,
                  accountId: scope.parentId,
                }
              : scope.parentKind === 'volcengine-account'
                ? {
                    kind: 'volcengine-account',
                    teamId: scope.teamId,
                    accountId: scope.parentId,
                  }
                : {
                    kind: 'gcp-project',
                    teamId: scope.teamId,
                    projectId: scope.parentId,
                    serviceAccountId: scope.serviceAccountId,
                  }
    const clusterListKey =
      scope.parentKind === 'aws-account'
        ? 'aws.clusters'
        : scope.parentKind === 'linode-account'
          ? 'linode.lke'
          : scope.parentKind === 'tencent-account'
            ? 'tencent.clusters'
            : scope.parentKind === 'aliyun-account'
              ? 'aliyun.clusters'
              : scope.parentKind === 'volcengine-account'
                ? 'volcengine.clusters'
                : 'gcp.clusters'
    const parentNavItems = activeNavItemsFor(parentScope, clusterListKey)

    out.push({
      label:
        scope.parentKind === 'aws-account'
          ? 'EKS'
          : scope.parentKind === 'linode-account'
            ? 'LKE'
            : scope.parentKind === 'tencent-account'
              ? 'TKE'
              : scope.parentKind === 'aliyun-account'
                ? 'ACK'
                : scope.parentKind === 'volcengine-account'
                  ? 'VKE'
                  : 'GKE',
      icon: <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      // Same as the resource picker below: drop connector-settings pages the
      // sidebar hides, so a drilled-in cluster's breadcrumb never offers them.
      options: parentNavItems
        .filter((item) => !isSettingsNavigation(parentScope, item.key))
        .map((item) => ({
          key: item.key,
          label: item.label,
          group: item.group,
          icon: item.icon,
          selected: item.key === clusterListKey,
          onPick: () => enterScope(parentScope, item.key),
        })),
    })
  }

  if (scope.kind === 'aws-ecs-cluster') {
    const parentScope: Scope = {
      kind: 'aws-account',
      teamId: scope.teamId,
      accountId: scope.accountId,
      roleId: scope.roleId,
    }
    const parentNavItems = activeNavItemsFor(parentScope, 'aws.ecs')

    out.push(
      {
        label: 'ECS',
        icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        options: parentNavItems
          .filter((item) => !isSettingsNavigation(parentScope, item.key))
          .map((item) => ({
            key: item.key,
            label: item.label,
            group: item.group,
            icon: item.icon,
            selected: item.key === 'aws.ecs',
            onPick: () => enterScope(parentScope, item.key),
          })),
      },
      {
        label: scope.clusterName,
        isResource: true,
        icon: <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
    )
  }

  if (scope.kind === 'team' && active === 'team.observability') {
    // The instance-list home carries no resource segments below it, so without
    // this leaf the breadcrumb collapses to a lone "Home" and the toolbar hides
    // it — leaving the page with no title once its PageHeader is gone.
    out.push({
      label: 'Observability',
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    })
  }

  if (
    scope.kind === 'team' &&
    (active === 'observability.dashboards' ||
      active === 'observability.alerts' ||
      active === 'observability.datasources') &&
    grafanaInstance
  ) {
    const instances = grafanaInstancesByTeam[scope.teamId]

    // Page ancestor so the back tree keeps a navigable level once the
    // resource segments (instance, dashboard) below are filtered out.
    out.push({
      label: 'Observability',
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      onClick: () => enterScope({ kind: 'team', teamId: scope.teamId }, 'team.observability'),
    })
    out.push({
      label: grafanaInstance.name,
      isResource: true,
      icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      loading: !instances,
      options: (instances ?? []).map((inst) => ({
        key: inst.id,
        label: inst.name,
        sublabel: inst.grafanaUrl,
        selected: inst.id === grafanaInstance.id,
        onPick: () => {
          updateActiveTab((tab) => ({
            ...tab,
            grafanaInstance: {
              id: inst.id,
              name: inst.name,
              url: inst.grafanaUrl,
            },
            // Dashboards differ between instances — drop the selection.
            dashboardTarget: null,
            traceDatasourceTarget: null,
            logDatasourceTarget: null,
          }))
        },
      })),
    })

    // The three sub-pages of a Grafana instance share one picker crumb, so the
    // breadcrumb doubles as the sub-navigation (mirrors the left sidebar's
    // Dashboards / Alerts / Datasources). Drilling into a dashboard or a
    // datasource explorer drops the dropdown and turns the crumb into a
    // back-link, per the breadcrumb drill-down convention.
    const grafanaSubTabs = [
      {
        key: 'observability.dashboards',
        label: 'Dashboards',
        icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
      {
        key: 'observability.alerts',
        label: 'Alerts',
        icon: <Bell className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
      {
        key: 'observability.datasources',
        label: 'Datasources',
        icon: <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      },
    ]
    const currentSubTab = grafanaSubTabs.find((t) => t.key === active)

    if (currentSubTab) {
      const explorerTarget = logDatasourceTarget ?? traceDatasourceTarget
      const inDashboardDetail = active === 'observability.dashboards' && Boolean(dashboardTarget)
      const inDatasourceExplorer = active === 'observability.datasources' && Boolean(explorerTarget)
      const inLeaf = inDashboardDetail || inDatasourceExplorer

      out.push({
        label: currentSubTab.label,
        icon: currentSubTab.icon,
        options: inLeaf
          ? undefined
          : grafanaSubTabs.map((t) => ({
              key: t.key,
              label: t.label,
              icon: t.icon,
              selected: t.key === active,
              onPick: () => onSidebarSelect(t.key),
            })),
        onClick: inDashboardDetail
          ? () => updateActiveTab((tab) => ({ ...tab, dashboardTarget: null }))
          : inDatasourceExplorer
            ? () =>
                updateActiveTab((tab) => ({
                  ...tab,
                  traceDatasourceTarget: null,
                  logDatasourceTarget: null,
                }))
            : undefined,
      })
      if (inDashboardDetail && dashboardTarget) {
        out.push({
          label: dashboardTarget.title,
          isResource: true,
          icon: <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        })
      }
      if (inDatasourceExplorer && explorerTarget) {
        out.push({
          label: explorerTarget.name,
          isResource: true,
          icon: <Database className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        })
      }
    }
  }
}
