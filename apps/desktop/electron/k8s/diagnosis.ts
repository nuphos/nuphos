import { diagnose, podHealth, workloadHealth } from '../../src/lib/kube-insight'

import { getClients, withAuthRetry } from './client'
import { is404 } from './errors'
import { podMatchesSelector } from './rows-workloads'

import type { ClusterClients } from './client'
import type { DiagnosableKind, ResourceDiagnosis, Workload } from '../../src/lib/kube-insight'
import type * as k8s from '@kubernetes/client-node'

// Reads the snapshot a detail page's diagnosis needs: the object, its pods and
// the Warning events about those pods. No Secret or ConfigMap is read: the
// rules work from the kubelet's own words, so their values never leave the
// cluster.

/** Pods read for one workload; beyond this the card speaks for a sample. */
const POD_LIMIT = 200

type Snapshot = { workload: Workload | null; pods: k8s.V1Pod[] }

/** The fields health reads, as a plain object tagged with its kind. */
type KubeObject = { metadata?: unknown; spec?: unknown; status?: unknown }

function pick<K extends Workload['kind']>(kind: K, obj: KubeObject) {
  return { kind, metadata: obj.metadata, spec: obj.spec, status: obj.status } as Extract<
    Workload,
    { kind: K }
  >
}

async function readWorkload(
  clients: ClusterClients,
  kind: Exclude<DiagnosableKind, 'Pod'>,
  namespace: string,
  name: string,
): Promise<{ workload: Workload; selector: k8s.V1LabelSelector | undefined }> {
  const { appsApi, batchApi } = clients

  switch (kind) {
    case 'Deployment': {
      const obj = await appsApi.readNamespacedDeployment({ namespace, name })

      return { workload: pick(kind, obj), selector: obj.spec?.selector }
    }
    case 'StatefulSet': {
      const obj = await appsApi.readNamespacedStatefulSet({ namespace, name })

      return { workload: pick(kind, obj), selector: obj.spec?.selector }
    }
    case 'DaemonSet': {
      const obj = await appsApi.readNamespacedDaemonSet({ namespace, name })

      return { workload: pick(kind, obj), selector: obj.spec?.selector }
    }
    case 'Job': {
      const obj = await batchApi.readNamespacedJob({ namespace, name })

      return { workload: pick(kind, obj), selector: obj.spec?.selector }
    }
  }
}

/** `a=b,c=d` from matchLabels; matchExpressions are applied client-side. */
function labelSelector(selector: k8s.V1LabelSelector): string | undefined {
  const pairs = Object.entries(selector.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`)

  return pairs.length > 0 ? pairs.join(',') : undefined
}

async function readSnapshot(
  clients: ClusterClients,
  kind: DiagnosableKind,
  namespace: string,
  name: string,
): Promise<Snapshot> {
  if (kind === 'Pod') {
    const pod = await clients.coreApi.readNamespacedPod({ namespace, name })

    return { workload: null, pods: [pod] }
  }
  const { workload, selector } = await readWorkload(clients, kind, namespace, name)

  if (!selector) return { workload, pods: [] }
  const res = await clients.coreApi.listNamespacedPod({
    namespace,
    labelSelector: labelSelector(selector),
  })
  const pods = res.items.filter((p) => podMatchesSelector(p, selector)).slice(0, POD_LIMIT)

  return { workload, pods }
}

async function readEvents(
  clients: ClusterClients,
  namespace: string,
  kind: DiagnosableKind,
  name: string,
) {
  // Every event the rules read (Failed, FailedMount, FailedScheduling,
  // Unhealthy) is a Warning about a Pod, so filter server-side.
  const fieldSelector =
    kind === 'Pod'
      ? `involvedObject.kind=Pod,involvedObject.name=${name},type=Warning`
      : 'involvedObject.kind=Pod,type=Warning'
  const res = await clients.coreApi.listNamespacedEvent({ namespace, fieldSelector })

  return res.items
}

export function getResourceDiagnosis(
  context: string,
  kind: DiagnosableKind,
  namespace: string,
  name: string,
): Promise<ResourceDiagnosis> {
  return withAuthRetry(context, async () => {
    const clients = getClients(context)
    let snapshot: Snapshot

    try {
      snapshot = await readSnapshot(clients, kind, namespace, name)
    } catch (e) {
      if (is404(e)) return { health: podHealth(null), diagnoses: [] }
      throw e
    }
    const events = await readEvents(clients, namespace, kind, name)
    const podNames = new Set(snapshot.pods.map((p) => p.metadata?.name))
    const diagnoses = diagnose({
      pods: snapshot.pods,
      events: events.filter((e) => podNames.has(e.involvedObject.name)),
      now: Date.now(),
    })
    const health = snapshot.workload
      ? workloadHealth(snapshot.workload)
      : podHealth(snapshot.pods[0])

    return { health, diagnoses }
  })
}
