import { api } from '../../api'
import {
  cronJobPhase,
  daemonSetPhase,
  deploymentPhase,
  jobPhase,
  nodePhase,
  podPhase,
  pvPhase,
  replicaSetPhase,
  statefulSetPhase,
  summarizePhases,
} from '../../lib/workloadStatus'

import { isRecent, RECENT_LIMIT } from './overviewTypes'

import type {
  OverviewCard,
  OverviewCore,
  OverviewExtras,
  ResourceSummary,
  RestartItem,
  WarningItem,
} from './overviewTypes'
import type { Tone } from '../../lib/workloadStatus'
import type { NodeItem } from '../../types'

function rowsOf<T>(result: PromiseSettledResult<T[]>): T[] | null {
  return result.status === 'fulfilled' ? result.value : null
}

// Sum a nullable node field, returning null only when no node reported it (so a
// metrics-server gap shows "–" rather than a misleading 0).
function sumField(nodes: NodeItem[], select: (n: NodeItem) => number | null): number | null {
  let any = false
  let total = 0

  for (const n of nodes) {
    const v = select(n)

    if (v != null) {
      any = true
      total += v
    }
  }

  return any ? total : null
}

// Pods that no longer occupy a schedulable slot. allocatable.pods (the meter's
// denominator) only counts Running/Pending, so the numerator must exclude these
// or batch-heavy clusters would read as over-capacity.
const TERMINAL_POD_STATUS = new Set(['succeeded', 'completed', 'failed', 'terminating'])

function schedulablePodCount(pods: { status: string }[]): number {
  return pods.filter((p) => !TERMINAL_POD_STATUS.has(p.status.toLowerCase())).length
}

function computeResources(nodes: NodeItem[], podCount: number | null): ResourceSummary {
  const cpuAlloc = sumField(nodes, (n) => n.cpu_capacity)
  const memAlloc = sumField(nodes, (n) => n.memory_capacity)
  const podsAlloc = sumField(nodes, (n) => n.pods_capacity)

  return {
    cpuUsage: { used: sumField(nodes, (n) => n.cpu), total: cpuAlloc },
    cpuRequest: { used: sumField(nodes, (n) => n.cpu_request), total: cpuAlloc },
    memUsage: { used: sumField(nodes, (n) => n.memory), total: memAlloc },
    memRequest: { used: sumField(nodes, (n) => n.memory_request), total: memAlloc },
    pods: { used: podCount, total: podsAlloc },
  }
}

// A workload/node/pv card: status breakdown, each segment clickable through to
// the matching `status=<phase>` list filter.
function phaseCard<T>(
  key: string,
  title: string,
  navKey: string,
  result: PromiseSettledResult<T[]>,
  phase: (row: T) => string,
): OverviewCard {
  const rows = rowsOf(result)

  return {
    key,
    title,
    navKey,
    total: rows ? rows.length : null,
    segments: rows
      ? summarizePhases(rows, phase).map((s) => ({ ...s, filter: `status=${s.label}` }))
      : [],
  }
}

export async function loadOverviewCore(context: string): Promise<OverviewCore> {
  // Settle independently so one failing resource degrades just its own card
  // (rendered "unavailable") instead of blanking the page; only a total
  // failure surfaces as a page error, which the silent-refresh retry can
  // recover from once the cluster is reachable again.
  const [nodes, pods, deps, rs, ss, ds, jobs, cron, svcs, nss, pvs, crds] =
    await Promise.allSettled([
      api.listNodes(context),
      api.listPods(context),
      api.listDeployments(context),
      api.listReplicaSets(context),
      api.listStatefulSets(context),
      api.listDaemonSets(context),
      api.listJobs(context),
      api.listCronJobs(context),
      api.listServices(context),
      api.listNamespaces(context),
      api.listPersistentVolumes(context),
      api.listCustomResourceDefinitions(context),
    ])
  const all = [nodes, pods, deps, rs, ss, ds, jobs, cron, svcs, nss, pvs, crds]

  if (all.every((r) => r.status === 'rejected')) {
    throw all.find((r) => r.status === 'rejected')!.reason
  }

  const crdRows = rowsOf(crds)
  const svcRows = rowsOf(svcs)
  const nsRows = rowsOf(nss)
  const nodeRows = rowsOf(nodes)
  const podRows = rowsOf(pods)

  const cards: OverviewCard[] = [
    phaseCard('nodes', 'Nodes', 'cluster.nodes', nodes, nodePhase),
    phaseCard('pods', 'Pods', 'workloads.pods', pods, podPhase),
    phaseCard('deployments', 'Deployments', 'workloads.deployments', deps, deploymentPhase),
    phaseCard('replicasets', 'ReplicaSets', 'workloads.replicasets', rs, replicaSetPhase),
    phaseCard('statefulsets', 'StatefulSets', 'workloads.statefulsets', ss, statefulSetPhase),
    phaseCard('daemonsets', 'DaemonSets', 'workloads.daemonsets', ds, daemonSetPhase),
    phaseCard('jobs', 'Jobs', 'workloads.jobs', jobs, jobPhase),
    phaseCard('cronjobs', 'CronJobs', 'workloads.cronjobs', cron, cronJobPhase),
    phaseCard(
      'persistentvolumes',
      'Persistent Volumes',
      'storage.persistent-volumes',
      pvs,
      pvPhase,
    ),
    {
      key: 'crds',
      title: 'CRDs',
      navKey: 'custom.crds',
      total: crdRows ? crdRows.length : null,
      // CRDs have no phase; show them as "Active" (not a status deep-link).
      segments: crdRows
        ? [{ label: 'Active', count: crdRows.length, tone: 'success' as Tone }]
        : [],
    },
    {
      key: 'services',
      title: 'Services',
      navKey: 'networking.services',
      total: svcRows ? svcRows.length : null,
      segments: [],
    },
    {
      key: 'namespaces',
      title: 'Namespaces',
      navKey: null,
      total: nsRows ? nsRows.length : null,
      segments: [],
    },
  ]

  // Resource usage aggregates from nodes (null if nodes failed to load).
  const resources = nodeRows
    ? computeResources(nodeRows, podRows ? schedulablePodCount(podRows) : null)
    : null

  const restarts: RestartItem[] | null = podRows
    ? podRows
        .filter((p) => isRecent(p.last_restart))
        .sort((a, b) => (b.last_restart ?? '').localeCompare(a.last_restart ?? ''))
        .slice(0, RECENT_LIMIT)
        .map((p) => ({
          key: `${p.namespace}/${p.name}`,
          namespace: p.namespace,
          name: p.name,
          restarts: p.restarts,
          iso: p.last_restart,
        }))
    : null

  return { cards, resources, restarts }
}

// Warning events + per-container metrics — typically the slowest calls on a
// big cluster, so they load separately and never gate the first paint.
// Failures degrade to null (panels render "Unavailable") instead of throwing.
export async function loadOverviewExtras(context: string): Promise<OverviewExtras> {
  const [events, usage] = await Promise.allSettled([
    // Only Warning events are surfaced here; filter server-side so a busy
    // cluster doesn't ship every event on each poll.
    api.listEvents(context, null, null, null, null, null, 'Warning'),
    // Per-container usage vs. limit for the abnormal-usage table. Rejects
    // (→ null → "Unavailable") when metrics-server is absent.
    api.listContainerUsage(context),
  ])

  // Warnings: events are already sorted newest-first by the main process.
  const eventRows = rowsOf(events)
  const warnings: WarningItem[] | null = eventRows
    ? eventRows
        .filter((e) => e.type_ === 'Warning' && isRecent(e.timestamp))
        .slice(0, RECENT_LIMIT)
        .map((e) => ({
          key: e.uid ?? `${e.namespace}/${e.kind}/${e.name}/${e.reason}/${e.timestamp ?? ''}`,
          reason: e.reason,
          object: e.name ? `${e.kind}/${e.name}` : e.kind,
          message: e.message,
          iso: e.timestamp,
        }))
    : null

  return { warnings, abnormal: rowsOf(usage) }
}
