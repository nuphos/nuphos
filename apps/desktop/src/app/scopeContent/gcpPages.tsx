import { faChartLine } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Cloud, Flame, KeyRound, LayoutDashboard, Server, Workflow } from 'lucide-react'

import { api } from '../../api'
import { clusterRowHref } from '../../app/clusterNamespaceStorage'
import { resourceListCacheKey, withResourceListCache } from '../../lib/resourceListCache'
import { toAbsoluteAtlasUrl } from '../../lib/webBaseUrl'
import {
  CloudClustersView,
  CloudRunServicesView,
  FirewallsView,
  GCEInstancesView,
  GcpMetricsExplorerView,
  VpcsView,
} from '../../views/CloudViews'
import { GcpDashboardBrowserView } from '../../views/GcpDashboardBrowserView'
import { GcpServiceAccountsView } from '../../views/IamPermissionsView'

import type { ScopeRenderContext } from './context'

export function renderGcpPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    accounts,
    onCount,
    onLoading,
    onPickGcpServiceAccount,
    onOpenGcpProjectServiceAccounts,
    onPickCluster,
    onOpenGceSsh,
    onAccountsChanged,
    openInChat,
    onOpenAgentChat,
    renderActiveNavPage,
    gcpServiceAccountId,
  } = ctx

  if (scope.kind === 'gcp-project') {
    // Mirror the AWS guard: don't cache while the service account is unresolved,
    // otherwise a list fetched under the default SA would hydrate a later
    // session before it revalidates against the real one.
    const gcpListCacheKey = (resource: string): string | undefined =>
      gcpServiceAccountId
        ? resourceListCacheKey('gcp', [
            scope.teamId,
            scope.projectId,
            gcpServiceAccountId,
            resource,
          ])
        : undefined

    if (active === 'gcp.vpcs') {
      return renderActiveNavPage(
        'VPC Networks',
        <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <VpcsView
          loader={withResourceListCache(gcpListCacheKey('vpcs'), () =>
            api.atlasListGcpVpcs(scope.teamId, scope.projectId, gcpServiceAccountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          getRowLink={(v) =>
            toAbsoluteAtlasUrl(
              `/teams/${encodeURIComponent(scope.teamId)}/infra/gcp/${encodeURIComponent(scope.projectId)}/vpcs/${encodeURIComponent(v.id)}`,
            )
          }
        />,
      )
    }
    if (active === 'gcp.firewalls') {
      return renderActiveNavPage(
        'Firewalls',
        <Flame className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <FirewallsView
          loader={withResourceListCache(gcpListCacheKey('firewalls'), () =>
            api.atlasListGcpFirewalls(scope.teamId, scope.projectId, gcpServiceAccountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          getRowLink={(f) =>
            toAbsoluteAtlasUrl(
              `/teams/${encodeURIComponent(scope.teamId)}/infra/gcp/${encodeURIComponent(scope.projectId)}/firewalls/${encodeURIComponent(f.name)}`,
            )
          }
        />,
      )
    }
    if (active === 'gcp.gce') {
      return renderActiveNavPage(
        'Compute Engine',
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <GCEInstancesView
          loader={withResourceListCache(gcpListCacheKey('compute-instances'), () =>
            api.atlasListGcpComputeInstances(scope.teamId, scope.projectId, gcpServiceAccountId),
          )}
          onOpenSsh={(instance) =>
            onOpenGceSsh({
              teamId: scope.teamId,
              projectId: scope.projectId,
              serviceAccountId: gcpServiceAccountId,
              instance,
            })
          }
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }
    if (active === 'gcp.metrics') {
      return renderActiveNavPage(
        'Metrics',
        <FontAwesomeIcon icon={faChartLine} className="w-3.5 h-3.5 text-tertiary" />,
        <GcpMetricsExplorerView
          // A tab can switch directly between GCP projects while remaining on
          // this page. Remount so selections and series from the old project
          // can never appear under the new project heading.
          key={`${scope.teamId}/${scope.projectId}/${gcpServiceAccountId ?? ''}`}
          descriptorsLoader={withResourceListCache(gcpListCacheKey('metric-descriptors'), () =>
            api.atlasListGcpMetricDescriptors(scope.teamId, scope.projectId, gcpServiceAccountId),
          )}
          dataLoader={(query) =>
            api.atlasQueryGcpMetricTimeSeries(
              scope.teamId,
              scope.projectId,
              query,
              gcpServiceAccountId,
            )
          }
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }
    if (active === 'gcp.dashboards') {
      return renderActiveNavPage(
        'Dashboards',
        <LayoutDashboard className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <GcpDashboardBrowserView
          key={`${scope.teamId}/${scope.projectId}/${gcpServiceAccountId ?? ''}`}
          teamId={scope.teamId}
          projectId={scope.projectId}
          serviceAccountId={gcpServiceAccountId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          onOpenAgentChat={onOpenAgentChat}
        />,
      )
    }
    if (active === 'gcp.cloudrun') {
      return renderActiveNavPage(
        'Cloud Run',
        <Workflow className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <CloudRunServicesView
          loader={withResourceListCache(gcpListCacheKey('cloudrun-services'), () =>
            api.atlasListGcpCloudRunServices(scope.teamId, scope.projectId, gcpServiceAccountId),
          )}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
          teamId={scope.teamId}
          projectId={scope.projectId}
          onFixInChat={openInChat}
        />,
      )
    }
    if (
      active === 'gcp.service-accounts' ||
      active === 'gcp.service-account' ||
      active === 'gcp.iam'
    ) {
      const serviceAccounts =
        accounts?.gcp.filter(
          (project) => project.projectId === scope.projectId && project.canUse !== false,
        ) ?? []
      const selectedServiceAccount =
        active === 'gcp.service-account' || active === 'gcp.iam'
          ? serviceAccounts.find((item) => item.serviceAccountId === scope.serviceAccountId)
          : undefined

      return renderActiveNavPage(
        'Service Accounts',
        <KeyRound className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <GcpServiceAccountsView
          onOpenAgentChat={onOpenAgentChat}
          teamId={scope.teamId}
          projectId={scope.projectId}
          serviceAccounts={serviceAccounts}
          filter={filter}
          selectedServiceAccountId={selectedServiceAccount?.serviceAccountId}
          refreshKey={refreshKey}
          onLoading={onLoading}
          onCount={onCount}
          onPick={onPickGcpServiceAccount}
          onAccessChanged={onAccountsChanged}
          onUnbound={onAccountsChanged}
          onCloseDetail={() => onOpenGcpProjectServiceAccounts(scope.projectId)}
        />,
      )
    }

    return renderActiveNavPage(
      'GKE Clusters',
      <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CloudClustersView
        loader={withResourceListCache(gcpListCacheKey('gke-clusters'), () =>
          api.atlasListGcpClusters(scope.teamId, scope.projectId, gcpServiceAccountId),
        )}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
        onPick={onPickCluster}
        getRowLink={(c) =>
          clusterRowHref({
            kind: 'cluster',
            teamId: scope.teamId,
            parentKind: 'gcp-project',
            parentId: scope.projectId,
            clusterName: c.name,
            provider: 'gcp',
            region: c.region,
            ...(gcpServiceAccountId ? { serviceAccountId: gcpServiceAccountId } : {}),
          })
        }
      />,
    )
  }

  return undefined
}
