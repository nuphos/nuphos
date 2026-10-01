import type { DeploymentEnvSource } from '../containerEnv'
import type * as k8s from '@kubernetes/client-node'

export type DeploymentEnvEntryInput = {
  name: string
  source: Exclude<DeploymentEnvSource, 'unknown' | 'fileKeyRef'>
  value?: string
  refName?: string
  key?: string
  optional?: boolean | null
  apiVersion?: string
  fieldPath?: string
  containerName?: string
  resource?: string
  divisor?: string
}

export type DeploymentEnvFromInput = {
  source: 'configMapRef' | 'secretRef'
  name: string
  prefix?: string
  optional?: boolean | null
}

export type DeploymentEnvUpdateInput = {
  env: DeploymentEnvEntryInput[]
  envFrom: DeploymentEnvFromInput[]
}

function normalizeEnvName(name: string): string {
  const normalized = name.trim()

  if (!normalized) throw new Error('Environment variable names cannot be empty.')
  if (!/^[\x20-\x7E]+$/.test(normalized) || normalized.includes('=')) {
    throw new Error(`"${normalized}" must use printable ASCII characters except "=".`)
  }

  return normalized
}

function normalizeOptional(value: boolean | null | undefined): boolean | undefined {
  return value == null ? undefined : value
}

function normalizeRequiredField(value: string | null | undefined, label: string): string {
  const normalized = (value ?? '').trim()

  if (!normalized) throw new Error(`${label} cannot be empty.`)

  return normalized
}

function normalizeOptionalField(value: string | null | undefined): string | undefined {
  const normalized = (value ?? '').trim()

  return normalized || undefined
}

export function normalizeDeploymentEnvInput(env: DeploymentEnvEntryInput[]): k8s.V1EnvVar[] {
  const names = new Set<string>()

  return env.map((item) => {
    const name = normalizeEnvName(item.name)

    if (names.has(name)) throw new Error(`"${name}" is duplicated.`)
    names.add(name)
    switch (item.source) {
      case 'value':
        return { name, value: item.value ?? '' }
      case 'configMapKeyRef':
        return {
          name,
          valueFrom: {
            configMapKeyRef: {
              name: normalizeRequiredField(item.refName, 'ConfigMap name'),
              key: normalizeRequiredField(item.key, 'ConfigMap key'),
              optional: normalizeOptional(item.optional),
            },
          },
        }
      case 'secretKeyRef':
        return {
          name,
          valueFrom: {
            secretKeyRef: {
              name: normalizeRequiredField(item.refName, 'Secret name'),
              key: normalizeRequiredField(item.key, 'Secret key'),
              optional: normalizeOptional(item.optional),
            },
          },
        }
      case 'fieldRef':
        return {
          name,
          valueFrom: {
            fieldRef: {
              apiVersion: normalizeOptionalField(item.apiVersion),
              fieldPath: normalizeRequiredField(item.fieldPath, 'Field path'),
            },
          },
        }
      case 'resourceFieldRef':
        return {
          name,
          valueFrom: {
            resourceFieldRef: {
              containerName: normalizeOptionalField(item.containerName),
              resource: normalizeRequiredField(item.resource, 'Resource'),
              divisor: normalizeOptionalField(item.divisor),
            },
          },
        }
      default:
        throw new Error(`Unsupported environment variable source: ${String(item.source)}.`)
    }
  })
}

export function normalizeEnvFromInput(envFrom: DeploymentEnvFromInput[]): k8s.V1EnvFromSource[] {
  return envFrom.map((item) => {
    const prefix = normalizeOptionalField(item.prefix)

    if (prefix && !/^[A-Za-z_]\w*$/.test(prefix)) {
      throw new Error(`"${prefix}" is not a valid envFrom prefix.`)
    }
    const name = normalizeRequiredField(
      item.name,
      item.source === 'secretRef' ? 'Secret name' : 'ConfigMap name',
    )
    const optional = normalizeOptional(item.optional)

    if (item.source === 'configMapRef') {
      return { prefix, configMapRef: { name, optional } }
    }
    if (item.source === 'secretRef') {
      return { prefix, secretRef: { name, optional } }
    }
    throw new Error(`Unsupported envFrom source: ${String(item.source)}.`)
  })
}

function hasKnownValueFrom(env: k8s.V1EnvVar): boolean {
  const valueFrom = env.valueFrom

  return Boolean(
    valueFrom?.configMapKeyRef ||
    valueFrom?.secretKeyRef ||
    valueFrom?.fieldRef ||
    valueFrom?.resourceFieldRef,
  )
}

export function preserveUnknownEnv(current: k8s.V1EnvVar[], next: k8s.V1EnvVar[]): k8s.V1EnvVar[] {
  const nextNames = new Set(next.map((env) => env.name))
  const preserved = current.filter((env) => env.valueFrom && !hasKnownValueFrom(env))

  for (const env of preserved) {
    if (nextNames.has(env.name)) {
      throw new Error(
        `"${env.name}" is defined by an unsupported reference and cannot be overwritten.`,
      )
    }
  }

  return [...next, ...preserved]
}

export function preserveUnknownEnvFrom(
  current: k8s.V1EnvFromSource[],
  next: k8s.V1EnvFromSource[],
): k8s.V1EnvFromSource[] {
  return [...next, ...current.filter((envFrom) => !envFrom.configMapRef && !envFrom.secretRef)]
}
