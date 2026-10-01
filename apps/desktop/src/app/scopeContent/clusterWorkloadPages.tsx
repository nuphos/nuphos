import { Bell, FolderTree, Package, Server } from 'lucide-react'

import { ClusterOverview } from '../../views/ClusterOverview'
import { DaemonSetsView } from '../../views/DaemonSetsView'
import { DeploymentsView } from '../../views/DeploymentsView'
import { EventsView } from '../../views/EventsView'
import { JobsView } from '../../views/JobsView'
import { CronJobsView, HelmReleasesView } from '../../views/K8sAdditionalResourceViews'
import { NodesView } from '../../views/NodesView'
import { ReplicaSetsView } from '../../views/ReplicaSetsView'
import { StatefulSetsView } from '../../views/StatefulSetsView'

import type { ScopeRenderContext } from './context'

export function renderClusterWorkloadPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    namespace,
    setTarget,
    onSelectActive,
    onCount,
    onLoading,
    renderActiveNavPage,
  } = ctx

  if (scope.kind !== 'cluster') return undefined

  if (active === 'cluster.overview') {
    return renderActiveNavPage(
      'Overview',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ClusterOverview refreshKey={refreshKey} onLoading={onLoading} onNavigate={onSelectActive} />,
    )
  }
  if (active === 'cluster.events') {
    return renderActiveNavPage(
      'Events',
      <Bell className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <EventsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'cluster.nodes') {
    return renderActiveNavPage(
      'Nodes',
      <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <NodesView
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(n) => setTarget({ kind: 'Node', namespace: null, name: n.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'workloads.deployments') {
    return renderActiveNavPage(
      'Deployments',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <DeploymentsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(d, initialTab) =>
          setTarget({
            kind: 'Deployment',
            namespace: d.namespace,
            name: d.name,
            age: d.age,
            initialTab,
          })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'workloads.replicasets') {
    return renderActiveNavPage(
      'ReplicaSets',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ReplicaSetsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(r) => setTarget({ kind: 'ReplicaSet', namespace: r.namespace, name: r.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'workloads.statefulsets') {
    return renderActiveNavPage(
      'StatefulSets',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <StatefulSetsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(s) =>
          setTarget({ kind: 'StatefulSet', namespace: s.namespace, name: s.name, age: s.age })
        }
        onSelectService={(serviceNamespace, name) =>
          setTarget({ kind: 'Service', namespace: serviceNamespace, name })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'workloads.daemonsets') {
    return renderActiveNavPage(
      'DaemonSets',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <DaemonSetsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(d) =>
          setTarget({ kind: 'DaemonSet', namespace: d.namespace, name: d.name, age: d.age })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'workloads.jobs') {
    return renderActiveNavPage(
      'Jobs',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <JobsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(j) => setTarget({ kind: 'Job', namespace: j.namespace, name: j.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'workloads.cronjobs') {
    return renderActiveNavPage(
      'CronJobs',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CronJobsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(c) => setTarget({ kind: 'CronJob', namespace: c.namespace, name: c.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'helm.releases') {
    return renderActiveNavPage(
      'Helm Releases',
      <Package className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <HelmReleasesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(r) =>
          setTarget({
            kind: 'HelmRelease',
            namespace: r.namespace,
            name: r.storage_name,
            displayName: r.name,
          })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  return undefined
}
