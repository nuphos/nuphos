import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import * as k8s from '@kubernetes/client-node'

import { getClients, withAuthRetry } from './client'

export function deletePod(context: string, namespace: string, name: string) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)

    await coreApi.deleteNamespacedPod({ name, namespace })
  })
}

const DELETE_API_VERSIONS: Record<string, string> = {
  Pod: 'v1',
  Service: 'v1',
  Node: 'v1',
  ConfigMap: 'v1',
  Secret: 'v1',
  ServiceAccount: 'v1',
  PersistentVolume: 'v1',
  PersistentVolumeClaim: 'v1',
  Deployment: 'apps/v1',
  ReplicaSet: 'apps/v1',
  StatefulSet: 'apps/v1',
  DaemonSet: 'apps/v1',
  Job: 'batch/v1',
  CronJob: 'batch/v1',
  Ingress: 'networking.k8s.io/v1',
  NetworkPolicy: 'networking.k8s.io/v1',
  EndpointSlice: 'discovery.k8s.io/v1',
  Role: 'rbac.authorization.k8s.io/v1',
  RoleBinding: 'rbac.authorization.k8s.io/v1',
  ClusterRole: 'rbac.authorization.k8s.io/v1',
  ClusterRoleBinding: 'rbac.authorization.k8s.io/v1',
  StorageClass: 'storage.k8s.io/v1',
  CustomResourceDefinition: 'apiextensions.k8s.io/v1',
}

export function deleteResource(
  context: string,
  kind: string,
  namespace: string | null,
  name: string,
  apiVersion?: string,
) {
  return withAuthRetry(context, async () => {
    const { kc } = getClients(context)
    const resolvedApiVersion = apiVersion || DELETE_API_VERSIONS[kind]

    if (!resolvedApiVersion) throw new Error(`Unsupported delete kind: ${kind}`)
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(kc)
    const spec: k8s.KubernetesObject = {
      apiVersion: resolvedApiVersion,
      kind,
      metadata: {
        name,
        ...(namespace ? { namespace } : {}),
      },
    }

    await objectApi.delete(spec)
  })
}

function execFileAsync(command: string, args: string[], options?: { timeout?: number }) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options?.timeout,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve()

          return
        }
        const output = [stderr, stdout].filter(Boolean).join('\n').trim()

        reject(new Error(output || err.message))
      },
    )
  })
}

export function uninstallHelmRelease(context: string, namespace: string, name: string) {
  return withAuthRetry(context, async () => {
    const { kc } = getClients(context)
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nuphos-helm-'))
    const kubeconfigPath = path.join(dir, 'config')

    try {
      await writeFile(kubeconfigPath, kc.exportConfig(), 'utf8')
      await execFileAsync(
        'helm',
        [
          'uninstall',
          name,
          '--namespace',
          namespace,
          '--kubeconfig',
          kubeconfigPath,
          '--kube-context',
          kc.getCurrentContext(),
        ],
        { timeout: 60_000 },
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

export function cordonNode(context: string, name: string, cordoned: boolean) {
  return withAuthRetry(context, async () => {
    const { coreApi } = getClients(context)

    await coreApi.patchNode(
      { name, body: { spec: { unschedulable: cordoned } } },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}

export type RestartableWorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet'

// `kubectl rollout restart` equivalent: stamp the pod template's restartedAt
// annotation so the controller rolls new pods. The same patch works for
// Deployment / StatefulSet / DaemonSet.
export function restartWorkload(
  context: string,
  kind: RestartableWorkloadKind,
  namespace: string,
  name: string,
) {
  return withAuthRetry(context, async () => {
    const { appsApi } = getClients(context)
    const body = {
      spec: {
        template: {
          metadata: {
            annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() },
          },
        },
      },
    }
    const opts = k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.StrategicMergePatch)

    // `kind` arrives over IPC, so the union type doesn't hold at runtime —
    // fail closed on anything unrecognized instead of patching a Deployment.
    if (kind === 'StatefulSet')
      await appsApi.patchNamespacedStatefulSet({ name, namespace, body }, opts)
    else if (kind === 'DaemonSet')
      await appsApi.patchNamespacedDaemonSet({ name, namespace, body }, opts)
    else if (kind === 'Deployment')
      await appsApi.patchNamespacedDeployment({ name, namespace, body }, opts)
    else throw new Error(`Unsupported workload kind: ${String(kind)}`)
  })
}

export function restartDeployment(context: string, namespace: string, name: string) {
  return restartWorkload(context, 'Deployment', namespace, name)
}

export function scaleDeployment(
  context: string,
  namespace: string,
  name: string,
  replicas: number,
) {
  return withAuthRetry(context, async () => {
    const { appsApi } = getClients(context)

    await appsApi.patchNamespacedDeployment(
      {
        name,
        namespace,
        body: {
          spec: {
            replicas,
          },
        },
      },
      k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.MergePatch),
    )
  })
}
