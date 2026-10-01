// Projection of a container's `env` / `envFrom` into the flat shape the
// renderer tables draw. Shared by the editable workload env table
// (`spec.template.spec.containers[]`) and the read-only Pod overview table
// (`spec.containers[]`), so both describe every `EnvVar` shape alike.
//
// Secrets: a `secretKeyRef` is reported as a *reference* (Secret name + key) —
// the Secret is never read, so no secret material flows through here. A plain
// `value` is passed through verbatim; those literals are already visible in
// the YAML tab.
import type * as k8s from '@kubernetes/client-node'

export type DeploymentEnvContainerType = 'containers' | 'initContainers'

export type DeploymentEnvSource =
  | 'value'
  | 'configMapKeyRef'
  | 'secretKeyRef'
  | 'fieldRef'
  | 'resourceFieldRef'
  | 'fileKeyRef'
  | 'unknown'

export type DeploymentEnvEntry = {
  name: string
  value: string | null
  source: DeploymentEnvSource
  sourceLabel: string
  optional: boolean | null
  refName: string | null
  key: string | null
  apiVersion: string | null
  fieldPath: string | null
  containerName: string | null
  resource: string | null
  divisor: string | null
  // fileKeyRef only: the volume mount holding the env file, and the file's
  // path within it.
  volumeName: string | null
  path: string | null
}

export type DeploymentEnvFromEntry = {
  source: 'configMapRef' | 'secretRef' | 'unknown'
  name: string | null
  prefix: string | null
  optional: boolean | null
}

export type DeploymentEnvContainer = {
  type: DeploymentEnvContainerType
  name: string
  image: string | null
  env: DeploymentEnvEntry[]
  envFrom: DeploymentEnvFromEntry[]
}

export function deploymentEnvEntry(env: k8s.V1EnvVar): DeploymentEnvEntry {
  const valueFrom = env.valueFrom

  if (!valueFrom) {
    return {
      name: env.name,
      value: env.value ?? '',
      source: 'value',
      sourceLabel: 'Value',
      optional: null,
      refName: null,
      key: null,
      apiVersion: null,
      fieldPath: null,
      containerName: null,
      resource: null,
      divisor: null,
      volumeName: null,
      path: null,
    }
  }
  if (valueFrom.configMapKeyRef) {
    const ref = valueFrom.configMapKeyRef

    return {
      name: env.name,
      value: null,
      source: 'configMapKeyRef',
      sourceLabel: `ConfigMap ${ref.name ?? '-'}/${ref.key}`,
      optional: ref.optional ?? null,
      refName: ref.name ?? null,
      key: ref.key ?? null,
      apiVersion: null,
      fieldPath: null,
      containerName: null,
      resource: null,
      divisor: null,
      volumeName: null,
      path: null,
    }
  }
  if (valueFrom.secretKeyRef) {
    const ref = valueFrom.secretKeyRef

    return {
      name: env.name,
      value: null,
      source: 'secretKeyRef',
      sourceLabel: `Secret ${ref.name ?? '-'}/${ref.key}`,
      optional: ref.optional ?? null,
      refName: ref.name ?? null,
      key: ref.key ?? null,
      apiVersion: null,
      fieldPath: null,
      containerName: null,
      resource: null,
      divisor: null,
      volumeName: null,
      path: null,
    }
  }
  if (valueFrom.fieldRef) {
    return {
      name: env.name,
      value: null,
      source: 'fieldRef',
      sourceLabel: `Field ${valueFrom.fieldRef.fieldPath}`,
      optional: null,
      refName: null,
      key: null,
      apiVersion: valueFrom.fieldRef.apiVersion ?? null,
      fieldPath: valueFrom.fieldRef.fieldPath ?? null,
      containerName: null,
      resource: null,
      divisor: null,
      volumeName: null,
      path: null,
    }
  }
  if (valueFrom.resourceFieldRef) {
    const ref = valueFrom.resourceFieldRef

    return {
      name: env.name,
      value: null,
      source: 'resourceFieldRef',
      sourceLabel: `Resource ${ref.resource}`,
      optional: null,
      refName: null,
      key: null,
      apiVersion: null,
      fieldPath: null,
      containerName: ref.containerName ?? null,
      resource: ref.resource ?? null,
      divisor: ref.divisor?.toString() ?? null,
      volumeName: null,
      path: null,
    }
  }
  if (valueFrom.fileKeyRef) {
    const ref = valueFrom.fileKeyRef

    return {
      name: env.name,
      value: null,
      source: 'fileKeyRef',
      sourceLabel: `File ${ref.volumeName}/${ref.path}:${ref.key}`,
      optional: ref.optional ?? null,
      refName: null,
      key: ref.key ?? null,
      apiVersion: null,
      fieldPath: null,
      containerName: null,
      resource: null,
      divisor: null,
      volumeName: ref.volumeName ?? null,
      path: ref.path ?? null,
    }
  }

  return {
    name: env.name,
    value: null,
    source: 'unknown',
    sourceLabel: 'Reference',
    optional: null,
    refName: null,
    key: null,
    apiVersion: null,
    fieldPath: null,
    containerName: null,
    resource: null,
    divisor: null,
    volumeName: null,
    path: null,
  }
}

export function deploymentEnvFromEntry(envFrom: k8s.V1EnvFromSource): DeploymentEnvFromEntry {
  if (envFrom.configMapRef) {
    return {
      source: 'configMapRef',
      name: envFrom.configMapRef.name ?? null,
      prefix: envFrom.prefix ?? null,
      optional: envFrom.configMapRef.optional ?? null,
    }
  }
  if (envFrom.secretRef) {
    return {
      source: 'secretRef',
      name: envFrom.secretRef.name ?? null,
      prefix: envFrom.prefix ?? null,
      optional: envFrom.secretRef.optional ?? null,
    }
  }

  return {
    source: 'unknown',
    name: null,
    prefix: envFrom.prefix ?? null,
    optional: null,
  }
}

export function deploymentEnvContainer(
  type: DeploymentEnvContainerType,
  container: k8s.V1Container,
): DeploymentEnvContainer {
  return {
    type,
    name: container.name,
    image: container.image ?? null,
    env: (container.env ?? []).map(deploymentEnvEntry),
    envFrom: (container.envFrom ?? []).map(deploymentEnvFromEntry),
  }
}

/**
 * The `env` / `envFrom` half of a container projection, for callers that
 * already carry their own container shape (the Pod overview's ContainerDetail).
 */
export function containerEnvProjection(container: k8s.V1Container): {
  env: DeploymentEnvEntry[]
  envFrom: DeploymentEnvFromEntry[]
} {
  return {
    env: (container.env ?? []).map(deploymentEnvEntry),
    envFrom: (container.envFrom ?? []).map(deploymentEnvFromEntry),
  }
}
