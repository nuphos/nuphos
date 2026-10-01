import { ageOf } from './utils'

import type * as k8s from '@kubernetes/client-node'

export type ConfigMapRow = {
  namespace: string
  name: string
  keys: number
  keyNames: string[]
  immutable: boolean
  age: string | null
}

export function mapConfigMapRow(cm: k8s.V1ConfigMap): ConfigMapRow {
  const dataKeys = Object.keys(cm.data ?? {})
  const binaryKeys = Object.keys(cm.binaryData ?? {})

  return {
    namespace: cm.metadata?.namespace ?? '',
    name: cm.metadata?.name ?? '',
    keys: dataKeys.length + binaryKeys.length,
    keyNames: [...dataKeys, ...binaryKeys].sort((a, b) => a.localeCompare(b)),
    immutable: cm.immutable === true,
    age: ageOf(cm.metadata?.creationTimestamp),
  }
}

export type SecretRow = {
  namespace: string
  name: string
  type: string
  keys: number
  keyNames: string[]
  age: string | null
}

export function mapSecretRow(s: k8s.V1Secret): SecretRow {
  const dataKeys = Object.keys(s.data ?? {})

  return {
    namespace: s.metadata?.namespace ?? '',
    name: s.metadata?.name ?? '',
    type: s.type ?? 'Opaque',
    keys: dataKeys.length,
    keyNames: dataKeys.toSorted((a, b) => a.localeCompare(b)),
    age: ageOf(s.metadata?.creationTimestamp),
  }
}

export type StorageClassRow = {
  name: string
  provisioner: string
  reclaim_policy: string
  volume_binding_mode: string
  is_default: boolean
  age: string | null
}

export function mapStorageClassRow(sc: k8s.V1StorageClass): StorageClassRow {
  return {
    name: sc.metadata?.name ?? '',
    provisioner: sc.provisioner ?? '',
    reclaim_policy: sc.reclaimPolicy ?? 'Delete',
    volume_binding_mode: sc.volumeBindingMode ?? 'Immediate',
    is_default:
      sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
    age: ageOf(sc.metadata?.creationTimestamp),
  }
}

export type PersistentVolumeRow = {
  name: string
  capacity: string | null
  access_modes: string[]
  reclaim_policy: string
  status: string
  claim: string | null
  storage_class: string | null
  age: string | null
}

export function mapPersistentVolumeRow(pv: k8s.V1PersistentVolume): PersistentVolumeRow {
  const claim = pv.spec?.claimRef

  return {
    name: pv.metadata?.name ?? '',
    capacity: pv.spec?.capacity?.storage ?? null,
    access_modes: pv.spec?.accessModes ?? [],
    reclaim_policy: pv.spec?.persistentVolumeReclaimPolicy ?? '',
    status: pv.status?.phase ?? 'Unknown',
    claim: claim?.name ? `${claim.namespace ?? ''}/${claim.name}` : null,
    storage_class: pv.spec?.storageClassName ?? null,
    age: ageOf(pv.metadata?.creationTimestamp),
  }
}

export type PersistentVolumeClaimRow = {
  namespace: string
  name: string
  status: string
  volume: string | null
  capacity: string | null
  access_modes: string[]
  storage_class: string | null
  age: string | null
}

export function mapPersistentVolumeClaimRow(
  pvc: k8s.V1PersistentVolumeClaim,
): PersistentVolumeClaimRow {
  return {
    namespace: pvc.metadata?.namespace ?? '',
    name: pvc.metadata?.name ?? '',
    status: pvc.status?.phase ?? 'Unknown',
    volume: pvc.spec?.volumeName ?? null,
    capacity: pvc.status?.capacity?.storage ?? null,
    access_modes: pvc.status?.accessModes ?? pvc.spec?.accessModes ?? [],
    storage_class: pvc.spec?.storageClassName ?? null,
    age: ageOf(pvc.metadata?.creationTimestamp),
  }
}
