import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parsePvSummary, parsePvcSummary, storagePhaseTone } from './storageOverview.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

// A representative Linode-provisioned PVC, mirroring the real objects the PV/PVC
// detail view loads (labels + provisioner annotations + Bound status).
const PVC_DOC = {
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  metadata: {
    name: 'data-service-abc',
    namespace: 'environment-xyz',
    creationTimestamp: '2025-11-23T02:00:00Z',
    labels: {
      zeabur_environment_id: 'env-1',
      zeabur_service_id: 'svc-1',
    },
    annotations: {
      'pv.kubernetes.io/bind-completed': 'yes',
      'volume.beta.kubernetes.io/storage-provisioner': 'linodebs.csi.linode.com',
    },
    finalizers: ['kubernetes.io/pvc-protection'],
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage: '1500Gi' } },
    volumeName: 'pvc-3473d55726',
    volumeMode: 'Filesystem',
    storageClassName: 'linode-block-storage-retain',
  },
  status: {
    phase: 'Bound',
    capacity: { storage: '1500Gi' },
  },
}

const PV_DOC = {
  apiVersion: 'v1',
  kind: 'PersistentVolume',
  metadata: {
    name: 'pvc-3473d55726',
    creationTimestamp: '2025-11-23T02:00:00Z',
    annotations: {
      'pv.kubernetes.io/provisioned-by': 'linodebs.csi.linode.com',
    },
    finalizers: ['kubernetes.io/pv-protection'],
  },
  spec: {
    capacity: { storage: '1500Gi' },
    accessModes: ['ReadWriteOnce'],
    persistentVolumeReclaimPolicy: 'Retain',
    volumeMode: 'Filesystem',
    storageClassName: 'linode-block-storage-retain',
    mountOptions: ['discard'],
    claimRef: { namespace: 'environment-xyz', name: 'data-service-abc' },
    csi: {
      driver: 'linodebs.csi.linode.com',
      volumeHandle: '123456-pvc-3473d55726',
      fsType: 'ext4',
    },
  },
  status: { phase: 'Bound' },
}

test('parsePvcSummary: pulls the Aptakube-baseline fields', () => {
  const s = parsePvcSummary(PVC_DOC)

  assert.equal(s.age, '2025-11-23T02:00:00Z')
  assert.equal(s.namespace, 'environment-xyz')
  assert.equal(s.phase, 'Bound')
  assert.equal(s.capacity, '1500Gi')
  assert.equal(s.requested, '1500Gi')
  assert.deepEqual(
    s.accessModes.map((c) => c.label),
    ['ReadWriteOnce'],
  )
  assert.equal(s.volumeMode, 'Filesystem')
  assert.equal(s.storageClass, 'linode-block-storage-retain')
  assert.equal(s.volumeName, 'pvc-3473d55726')
})

test('parsePvcSummary: labels / annotations / finalizers become key:value chips', () => {
  const s = parsePvcSummary(PVC_DOC)

  assert.deepEqual(
    s.labels.map((c) => c.label),
    ['zeabur_environment_id: env-1', 'zeabur_service_id: svc-1'],
  )
  assert.ok(
    s.annotations.some(
      (c) => c.label === 'volume.beta.kubernetes.io/storage-provisioner: linodebs.csi.linode.com',
    ),
  )
  assert.deepEqual(
    s.finalizers.map((c) => c.label),
    ['kubernetes.io/pvc-protection'],
  )
})

test('parsePvcSummary: missing fields fall back to - and null, never throw', () => {
  const s = parsePvcSummary({ kind: 'PersistentVolumeClaim' })

  assert.equal(s.namespace, '-')
  assert.equal(s.phase, null)
  assert.equal(s.capacity, '-')
  assert.equal(s.requested, '-')
  assert.equal(s.volumeMode, '-')
  assert.equal(s.storageClass, '-')
  assert.equal(s.volumeName, null)
  assert.deepEqual(s.accessModes, [])
  assert.deepEqual(s.labels, [])
  assert.equal(s.age, null)
})

test('parsePvcSummary: garbage input yields an all-empty summary', () => {
  for (const bad of [null, undefined, 42, 'nope', []]) {
    const s = parsePvcSummary(bad)

    assert.equal(s.namespace, '-')
    assert.equal(s.volumeName, null)
    assert.deepEqual(s.finalizers, [])
  }
})

test('parsePvSummary: pulls the Aptakube-baseline fields + reclaim policy', () => {
  const s = parsePvSummary(PV_DOC)

  assert.equal(s.age, '2025-11-23T02:00:00Z')
  assert.equal(s.phase, 'Bound')
  assert.equal(s.capacity, '1500Gi')
  assert.equal(s.reclaimPolicy, 'Retain')
  assert.equal(s.volumeMode, 'Filesystem')
  assert.equal(s.storageClass, 'linode-block-storage-retain')
  assert.deepEqual(
    s.accessModes.map((c) => c.label),
    ['ReadWriteOnce'],
  )
})

test('parsePvSummary: claimRef becomes a namespace/name link target', () => {
  const s = parsePvSummary(PV_DOC)

  assert.deepEqual(s.claim, { namespace: 'environment-xyz', name: 'data-service-abc' })
})

test('parsePvSummary: exposes CSI source + mount options (beyond Aptakube)', () => {
  const s = parsePvSummary(PV_DOC)

  assert.deepEqual(s.csi, {
    driver: 'linodebs.csi.linode.com',
    volumeHandle: '123456-pvc-3473d55726',
    fsType: 'ext4',
  })
  assert.deepEqual(
    s.mountOptions.map((c) => c.label),
    ['discard'],
  )
})

test('parsePvSummary: claimRef with name but no namespace keeps namespace null', () => {
  // The view uses this to withhold the (namespaced) PVC cross-link.
  const s = parsePvSummary({
    kind: 'PersistentVolume',
    spec: { claimRef: { name: 'orphan-claim' } },
    status: { phase: 'Bound' },
  })

  assert.deepEqual(s.claim, { namespace: null, name: 'orphan-claim' })
})

test('parsePvSummary: no claimRef.name → claim is null (Available volume)', () => {
  const s = parsePvSummary({
    kind: 'PersistentVolume',
    spec: { capacity: { storage: '10Gi' }, claimRef: {} },
    status: { phase: 'Available' },
  })

  assert.equal(s.claim, null)
  assert.equal(s.phase, 'Available')
})

test('parsePvSummary: no CSI block → csi is null', () => {
  const s = parsePvSummary({ kind: 'PersistentVolume', spec: {} })

  assert.equal(s.csi, null)
  assert.equal(s.capacity, '-')
  assert.equal(s.reclaimPolicy, '-')
  assert.deepEqual(s.mountOptions, [])
})

test('storagePhaseTone: maps k8s phases to display tones', () => {
  assert.equal(storagePhaseTone('Bound'), 'good')
  assert.equal(storagePhaseTone('Available'), 'good')
  assert.equal(storagePhaseTone('Pending'), 'warning')
  assert.equal(storagePhaseTone('Released'), 'warning')
  assert.equal(storagePhaseTone('Failed'), 'error')
  assert.equal(storagePhaseTone('Lost'), 'error')
  assert.equal(storagePhaseTone(null), 'default')
  assert.equal(storagePhaseTone('Weird'), 'default')
})
