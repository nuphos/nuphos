// Pure parsers for the PersistentVolume / PersistentVolumeClaim detail
// Overview (PV/PVC overview >= Aptakube). No React, no
// electron — unit-tested in storageOverview.test.ts.
//
// Both take an already-parsed k8s object (the renderer does `yaml.load(text)`
// on the full object returned by getResourceYaml) and pull out the fields worth
// surfacing. Scalars fall back to '-'; link fields (volumeName / claimRef) stay
// null so the view can decide between a clickable link and a dash.

export type StorageChip = { label: string; title?: string }

export type StoragePhaseTone = 'good' | 'warning' | 'error' | 'default'

export type PvcSummary = {
  age: string | null
  namespace: string
  phase: string | null
  capacity: string
  requested: string
  accessModes: StorageChip[]
  volumeMode: string
  storageClass: string
  volumeName: string | null
  labels: StorageChip[]
  annotations: StorageChip[]
  finalizers: StorageChip[]
}

export type PvClaimRef = { namespace: string | null; name: string }

export type PvCsi = { driver: string; volumeHandle: string | null; fsType: string | null }

export type PvSummary = {
  age: string | null
  phase: string | null
  capacity: string
  accessModes: StorageChip[]
  reclaimPolicy: string
  volumeMode: string
  storageClass: string
  claim: PvClaimRef | null
  csi: PvCsi | null
  mountOptions: StorageChip[]
  labels: StorageChip[]
  annotations: StorageChip[]
  finalizers: StorageChip[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, key: string): UnknownRecord {
  if (!isRecord(value)) return {}
  const next = value[key]

  return isRecord(next) ? next : {}
}

function stringAt(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const next = value[key]

  return typeof next === 'string' ? next : null
}

function stringArrayAt(value: unknown, key: string): string[] {
  if (!isRecord(value)) return []
  const next = value[key]

  return Array.isArray(next) ? next.filter((v): v is string => typeof v === 'string') : []
}

function recordStringEntries(value: unknown): [string, string][] {
  if (!isRecord(value)) return []

  return Object.entries(value).flatMap(([key, val]) =>
    typeof val === 'string' ? [[key, val] as [string, string]] : [],
  )
}

function pairChips(entries: [string, string][]): StorageChip[] {
  return entries.map(([key, value]) => ({
    label: `${key}: ${value}`,
    title: `${key}: ${value}`,
  }))
}

function valueChips(values: string[]): StorageChip[] {
  return values.map((value) => ({ label: value }))
}

// Phase color, matching Aptakube: Bound/Available are healthy (green), Pending/
// Released warrant attention (amber), Failed/Lost are errors (red).
export function storagePhaseTone(phase: string | null): StoragePhaseTone {
  switch (phase) {
    case 'Bound':
    case 'Available':
      return 'good'
    case 'Pending':
    case 'Released':
      return 'warning'
    case 'Failed':
    case 'Lost':
      return 'error'
    case null:
    default:
      return 'default'
  }
}

export function parsePvcSummary(doc: unknown): PvcSummary {
  const root = isRecord(doc) ? doc : {}
  const metadata = recordAt(root, 'metadata')
  const spec = recordAt(root, 'spec')
  const status = recordAt(root, 'status')

  return {
    age: stringAt(metadata, 'creationTimestamp'),
    namespace: stringAt(metadata, 'namespace') ?? '-',
    phase: stringAt(status, 'phase'),
    capacity: stringAt(recordAt(status, 'capacity'), 'storage') ?? '-',
    requested: stringAt(recordAt(recordAt(spec, 'resources'), 'requests'), 'storage') ?? '-',
    accessModes: valueChips(stringArrayAt(spec, 'accessModes')),
    volumeMode: stringAt(spec, 'volumeMode') ?? '-',
    storageClass: stringAt(spec, 'storageClassName') ?? '-',
    volumeName: stringAt(spec, 'volumeName'),
    labels: pairChips(recordStringEntries(recordAt(metadata, 'labels'))),
    annotations: pairChips(recordStringEntries(recordAt(metadata, 'annotations'))),
    finalizers: valueChips(stringArrayAt(metadata, 'finalizers')),
  }
}

export function parsePvSummary(doc: unknown): PvSummary {
  const root = isRecord(doc) ? doc : {}
  const metadata = recordAt(root, 'metadata')
  const spec = recordAt(root, 'spec')
  const status = recordAt(root, 'status')
  const claimRef = recordAt(spec, 'claimRef')
  const claimName = stringAt(claimRef, 'name')
  const csi = recordAt(spec, 'csi')
  const csiDriver = stringAt(csi, 'driver')

  return {
    age: stringAt(metadata, 'creationTimestamp'),
    phase: stringAt(status, 'phase'),
    capacity: stringAt(recordAt(spec, 'capacity'), 'storage') ?? '-',
    accessModes: valueChips(stringArrayAt(spec, 'accessModes')),
    reclaimPolicy: stringAt(spec, 'persistentVolumeReclaimPolicy') ?? '-',
    volumeMode: stringAt(spec, 'volumeMode') ?? '-',
    storageClass: stringAt(spec, 'storageClassName') ?? '-',
    claim: claimName ? { namespace: stringAt(claimRef, 'namespace'), name: claimName } : null,
    csi: csiDriver
      ? {
          driver: csiDriver,
          volumeHandle: stringAt(csi, 'volumeHandle'),
          fsType: stringAt(csi, 'fsType'),
        }
      : null,
    mountOptions: valueChips(stringArrayAt(spec, 'mountOptions')),
    labels: pairChips(recordStringEntries(recordAt(metadata, 'labels'))),
    annotations: pairChips(recordStringEntries(recordAt(metadata, 'annotations'))),
    finalizers: valueChips(stringArrayAt(metadata, 'finalizers')),
  }
}
