import { ageOf } from './utils'

import type * as k8s from '@kubernetes/client-node'

export type HelmReleaseRow = {
  namespace: string
  name: string
  revision: string
  status: string
  chart: string
  app_version: string
  storage_kind: 'Secret' | 'ConfigMap'
  storage_name: string
  age: string | null
}

export function mapHelmReleaseRow(
  obj: k8s.V1Secret | k8s.V1ConfigMap,
  storageKind: 'Secret' | 'ConfigMap',
): HelmReleaseRow {
  const labels = obj.metadata?.labels ?? {}

  return {
    namespace: obj.metadata?.namespace ?? '',
    name: labels.name ?? obj.metadata?.name ?? '',
    revision: labels.version ?? '',
    status: labels.status ?? '',
    chart: labels.chart ?? '',
    app_version: labels.app_version ?? labels.appVersion ?? '',
    storage_kind: storageKind,
    storage_name: obj.metadata?.name ?? '',
    age: ageOf(obj.metadata?.creationTimestamp),
  }
}

export type CustomResourceDefinitionRow = {
  name: string
  group: string
  kind: string
  plural: string
  scope: string
  versions: string[]
  served_version: string | null
  stored_versions: string[]
  age: string | null
}

/** The version to read a CRD's objects through: the storage version when it is
 *  served, else the first served one. `spec.versions` is in author order, so
 *  picking "first served" alone pins deprecated alpha/beta versions on CRDs
 *  that list them first (Gateway API, Istio, …). */
export function readableCrdVersion(crd: k8s.V1CustomResourceDefinition): string | null {
  const versions = (crd.spec?.versions ?? []).filter((version) => version.served)

  return (versions.find((version) => version.storage) ?? versions[0])?.name ?? null
}

export function mapCustomResourceDefinitionRow(
  crd: k8s.V1CustomResourceDefinition,
): CustomResourceDefinitionRow {
  return {
    name: crd.metadata?.name ?? '',
    group: crd.spec?.group ?? '',
    kind: crd.spec?.names?.kind ?? '',
    plural: crd.spec?.names?.plural ?? '',
    scope: crd.spec?.scope ?? '',
    versions: (crd.spec?.versions ?? []).map((v) => v.name).filter(Boolean),
    served_version: readableCrdVersion(crd),
    stored_versions: crd.status?.storedVersions ?? [],
    age: ageOf(crd.metadata?.creationTimestamp),
  }
}

export type CustomResourceRow = {
  apiVersion: string
  kind: string
  plural: string
  namespaced: boolean
  namespace: string | null
  name: string
  uid: string | null
  status: string
  age: string | null
}

export function mapCustomResourceRow(
  obj: { apiVersion?: string; kind?: string; metadata?: k8s.V1ObjectMeta; status?: unknown },
  opts: { apiVersion: string; kind: string; plural: string; namespaced: boolean },
): CustomResourceRow {
  return {
    apiVersion: obj.apiVersion ?? opts.apiVersion,
    kind: obj.kind ?? opts.kind,
    plural: opts.plural,
    namespaced: opts.namespaced,
    namespace: obj.metadata?.namespace ?? null,
    name: obj.metadata?.name ?? '',
    uid: obj.metadata?.uid ?? null,
    status: customStatus(obj.status),
    age: ageOf(obj.metadata?.creationTimestamp),
  }
}

function customStatus(status: unknown): string {
  if (!status || typeof status !== 'object') return ''
  const s = status as Record<string, unknown>

  for (const key of ['phase', 'state', 'status']) {
    const value = s[key]

    if (typeof value === 'string') return value
  }
  const conditions = s.conditions

  if (Array.isArray(conditions)) {
    const ready = conditions.find(
      (c) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'Ready',
    ) as Record<string, unknown> | undefined

    if (typeof ready?.status === 'string') return `Ready=${ready.status}`
  }

  return ''
}
