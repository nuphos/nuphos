import * as k8s from '@kubernetes/client-node'

import { deploymentEnvContainer } from '../containerEnv'

import { getClients, withAuthRetry } from './client'
import {
  normalizeDeploymentEnvInput,
  normalizeEnvFromInput,
  preserveUnknownEnv,
  preserveUnknownEnvFrom,
} from './env-normalize'

import type { DeploymentEnvContainer, DeploymentEnvContainerType } from '../containerEnv'
import type { DeploymentEnvUpdateInput } from './env-normalize'

export type DeploymentEnvDetail = {
  namespace: string
  name: string
  containers: DeploymentEnvContainer[]
}

export type EditableWorkloadEnvKind = 'Deployment' | 'StatefulSet' | 'DaemonSet'

type JsonPatchOperation = {
  op: 'add' | 'replace' | 'remove' | 'test'
  path: string
  value?: unknown
}

async function readEnvWorkload(
  appsApi: k8s.AppsV1Api,
  kind: EditableWorkloadEnvKind,
  namespace: string,
  name: string,
) {
  if (kind === 'Deployment') return appsApi.readNamespacedDeployment({ name, namespace })
  if (kind === 'StatefulSet') return appsApi.readNamespacedStatefulSet({ name, namespace })

  return appsApi.readNamespacedDaemonSet({ name, namespace })
}

async function patchEnvWorkload(
  appsApi: k8s.AppsV1Api,
  kind: EditableWorkloadEnvKind,
  namespace: string,
  name: string,
  body: JsonPatchOperation[],
) {
  const options = k8s.setHeaderOptions('Content-Type', k8s.PatchStrategy.JsonPatch)

  if (kind === 'Deployment') {
    await appsApi.patchNamespacedDeployment({ name, namespace, body }, options)

    return
  }
  if (kind === 'StatefulSet') {
    await appsApi.patchNamespacedStatefulSet({ name, namespace, body }, options)

    return
  }
  await appsApi.patchNamespacedDaemonSet({ name, namespace, body }, options)
}

export function getDeploymentEnv(
  context: string,
  kind: EditableWorkloadEnvKind,
  namespace: string,
  name: string,
): Promise<DeploymentEnvDetail> {
  return withAuthRetry(context, async () => {
    const { appsApi } = getClients(context)
    const workload = await readEnvWorkload(appsApi, kind, namespace, name)
    const podSpec = workload.spec?.template?.spec

    return {
      namespace: workload.metadata?.namespace ?? namespace,
      name: workload.metadata?.name ?? name,
      containers: [
        ...(podSpec?.containers ?? []).map((container) =>
          deploymentEnvContainer('containers', container),
        ),
        ...(podSpec?.initContainers ?? []).map((container) =>
          deploymentEnvContainer('initContainers', container),
        ),
      ],
    }
  })
}

export function updateDeploymentContainerEnv(
  context: string,
  kind: EditableWorkloadEnvKind,
  namespace: string,
  name: string,
  containerType: DeploymentEnvContainerType,
  containerName: string,
  input: DeploymentEnvUpdateInput,
) {
  return withAuthRetry(context, async () => {
    const { appsApi } = getClients(context)
    const workload = await readEnvWorkload(appsApi, kind, namespace, name)
    const containers = workload.spec?.template?.spec?.[containerType]

    if (!containers) throw new Error(`${kind} has no ${containerType}.`)
    const containerIndex = containers.findIndex((container) => container.name === containerName)

    if (containerIndex < 0) throw new Error(`Container "${containerName}" was not found.`)
    const container = containers[containerIndex]
    const nextEnv = preserveUnknownEnv(
      container.env ?? [],
      normalizeDeploymentEnvInput(input.env ?? []),
    )
    const nextEnvFrom = preserveUnknownEnvFrom(
      container.envFrom ?? [],
      normalizeEnvFromInput(input.envFrom ?? []),
    )
    const envPath = `/spec/template/spec/${containerType}/${String(containerIndex)}/env`
    const envFromPath = `/spec/template/spec/${containerType}/${String(containerIndex)}/envFrom`
    const containerNamePath = `/spec/template/spec/${containerType}/${String(containerIndex)}/name`
    const body: JsonPatchOperation[] = [
      { op: 'test', path: containerNamePath, value: containerName },
    ]

    if (nextEnv.length === 0) {
      if (container.env) body.push({ op: 'remove', path: envPath })
    } else {
      body.push({ op: container.env ? 'replace' : 'add', path: envPath, value: nextEnv })
    }
    if (nextEnvFrom.length === 0) {
      if (container.envFrom) body.push({ op: 'remove', path: envFromPath })
    } else {
      body.push({
        op: container.envFrom ? 'replace' : 'add',
        path: envFromPath,
        value: nextEnvFrom,
      })
    }
    if (body.length === 1) return
    await patchEnvWorkload(appsApi, kind, namespace, name, body)
  })
}
