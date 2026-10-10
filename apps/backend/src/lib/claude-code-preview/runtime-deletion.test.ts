import { beforeEach, expect, test } from 'bun:test'

import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useDb } from '@/lib/test/doubles/db'
import { useRedis } from '@/lib/test/doubles/redis'
import { useRuntimeWorkspace } from '@/lib/test/doubles/runtime-workspace'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { placementNamespace, RUNTIME_CONTROLLER_STALE_MS } from './runtime-controllers'
import { reconcileRuntimeDeletions } from './runtime-deletion'
import { hostedRuntimeName, hostedRuntimeUrl } from './runtime-objects'

import type { KubeClient, KubeResourceState } from './kube-client'
import type { RuntimeDeletion } from './runtime-portability-store'

let memory = portabilityDb()
const actions: string[] = []

useDb({ db: () => memory })
useRedis({ redisEnabled: () => true })
useAgentRunStore({
  getActiveAgentRunForSession: async () => null,
  reserveActiveAgentRunForSession: async () => null,
})
useRuntimeWorkspace({
  findWorkspaceArchive: async () => {
    throw new Error('Deletion must not read backups')
  },
  saveRuntimeWorkspace: async () => {
    throw new Error('Deletion must not create backups')
  },
})
const teamId = '123456789012345678901234'
const namespace = 'openab-runtimes'
const runtimeId = 'hosted-runtime'
const name = hostedRuntimeName(teamId, 'claude-code', runtimeId)
const elsewhere = (environment: string) => hostedRuntimeUrl(name, environment)
const hostedRow = () => memory.rows('claude_code_runtimes').filter((row) => row._id === runtimeId)
let resources: Map<string, KubeResourceState>
let job: RuntimeDeletion
const kube: KubeClient = {
  apply: async () => {},
  createIfAbsent: async () => true,
  getSecret: async () => null,
  getResource: async (resource) =>
    resources.get(`${resource.kind}/${resource.metadata.name}`) ?? null,
  delete: async (resource, uid) => {
    const key = `${resource.kind}/${resource.metadata.name}`

    if (uid && resources.get(key)?.metadata.uid !== uid) throw new Error('UID changed')
    actions.push(`delete:${resource.kind}`)
    resources.delete(key)
  },
}
const tick = () => reconcileRuntimeDeletions(namespace, 'claude-code', kube)

beforeEach(() => {
  memory = portabilityDb()
  actions.length = 0
  job = {
    _id: runtimeId,
    teamId,
    provider: 'claude-code',
    requestedBy: 'owner',
    requestedAt: new Date(),
    placements: [{ id: runtimeId, url: hostedRuntimeUrl(name, namespace), state: 'pending' }],
  }
  memory.rows('agent_runtime_deletions').push(job)
  memory.rows('claude_code_runtimes').push({
    _id: runtimeId,
    teamId,
    url: job.placements[0]!.url,
    hostedBy: 'nuphos',
    status: 'active',
    createdByUserId: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  memory.rows('agent_conversations').push({
    sessionId: 'conversation',
    teamId,
    userId: 'owner',
    claudeCodePreview: { runtimeUrl: job.placements[0]!.url },
  })
  resources = new Map([
    [`Deployment/${name}`, { metadata: { uid: 'deployment' } }],
    [`Service/${name}`, { metadata: { uid: 'service' } }],
    [
      `PersistentVolumeClaim/${name}-home`,
      { metadata: { uid: 'claim' }, spec: { volumeName: 'volume' } },
    ],
    [
      'PersistentVolume/volume',
      {
        metadata: { uid: 'volume' },
        spec: { persistentVolumeReclaimPolicy: 'Delete', claimRef: { uid: 'claim' } },
      },
    ],
    [
      `PersistentVolumeClaim/${name}-workspace`,
      { metadata: { uid: 'workspace-claim' }, spec: { volumeName: 'workspace-volume' } },
    ],
    [
      'PersistentVolume/workspace-volume',
      {
        metadata: { uid: 'workspace-volume' },
        spec: { persistentVolumeReclaimPolicy: 'Delete', claimRef: { uid: 'workspace-claim' } },
      },
    ],
  ])
})
test('the workspace volume is guarded and awaited exactly like the home volume', async () => {
  resources.get('PersistentVolume/workspace-volume')!.spec!.persistentVolumeReclaimPolicy = 'Retain'
  await tick()
  expect(actions).toEqual([])
  resources.get('PersistentVolume/workspace-volume')!.spec!.persistentVolumeReclaimPolicy = 'Delete'
  await tick()
  await tick()
  resources.delete('PersistentVolume/volume')
  await tick()
  expect(resources.has(`PersistentVolumeClaim/${name}-workspace`)).toBe(false)
  await tick()
  await tick()
  // The claim is gone but its disk is not yet: the runtime is not deleted.
  expect(job.completedAt).toBeUndefined()
  expect(hostedRow()).toHaveLength(1)
  resources.delete('PersistentVolume/workspace-volume')
  await tick()
  await tick()
  expect(job.completedAt).toBeInstanceOf(Date)
})
test('a replaced workspace claim stops the deletion', async () => {
  await tick()
  resources.get(`PersistentVolumeClaim/${name}-workspace`)!.metadata.uid = 'replacement'
  await tick()
  expect(actions).not.toContain('delete:PersistentVolumeClaim')
  expect(job.error).toBeTruthy()
})
test('waits for the PV controller before removing credentials', async () => {
  await tick()
  expect(actions.slice(0, 1)).toEqual(['delete:Deployment'])
  await tick()
  expect(actions).toContain('delete:PersistentVolumeClaim')
  await tick()
  expect(job.completedAt).toBeUndefined()
  expect(hostedRow()).toHaveLength(1)
  resources.delete('PersistentVolume/volume')
  await tick()
  expect(actions.filter((action) => action === 'delete:PersistentVolumeClaim')).toHaveLength(2)
  resources.delete('PersistentVolume/workspace-volume')
  await tick()
  await tick()
  expect(job.completedAt).toBeInstanceOf(Date)
  expect(hostedRow()).toHaveLength(0)
})
test('both claims and the service start deleting in the same pass after pods terminate', async () => {
  await tick()
  expect(actions).toEqual(['delete:Deployment'])
  await tick()
  expect(actions).toEqual([
    'delete:Deployment',
    'delete:PersistentVolumeClaim',
    'delete:PersistentVolumeClaim',
    'delete:Service',
  ])
  expect(job.completedAt).toBeUndefined()
  resources.delete('PersistentVolume/volume')
  await tick()
  expect(job.completedAt).toBeUndefined()
  resources.delete('PersistentVolume/workspace-volume')
  await tick()
  expect(job.completedAt).toBeInstanceOf(Date)
})

test('Retain policy and replacement claim identities cannot be deleted', async () => {
  resources.get('PersistentVolume/volume')!.spec!.persistentVolumeReclaimPolicy = 'Retain'
  await tick()
  expect(actions).toEqual([])
  resources.get('PersistentVolume/volume')!.spec!.persistentVolumeReclaimPolicy = 'Delete'
  await tick()
  resources.get(`PersistentVolumeClaim/${name}-home`)!.metadata.uid = 'replacement'
  await tick()
  expect(actions).not.toContain('delete:PersistentVolumeClaim')
  expect(job.completedAt).toBeUndefined()
})
test('another environment must finish saving and deleting its own placement', async () => {
  job.placements.push({
    id: 'other-placement',
    url: elsewhere('other-environment'),
    state: 'pending',
  })
  await tick()
  await tick()
  resources.delete('PersistentVolume/volume')
  resources.delete('PersistentVolume/workspace-volume')
  await tick()
  await tick()
  await tick()
  expect(job.placements[0]!.state).toBe('deleted')
  expect(job.placements[1]!.state).toBe('pending')
  expect(job.completedAt).toBeUndefined()
  expect(hostedRow()).toHaveLength(1)
})

test('a placement whose environment stopped reconciling is abandoned, not waited on forever', async () => {
  const staleSince = new Date(Date.now() - RUNTIME_CONTROLLER_STALE_MS - 60_000)
  const orphanUrl = elsewhere('retired-environment')

  job.requestedAt = staleSince
  job.placements.push({ id: 'orphan', url: orphanUrl, state: 'pending' })
  memory.rows('claude_code_runtimes').push({
    _id: 'orphan',
    teamId,
    url: orphanUrl,
    status: 'active',
    createdAt: staleSince,
    updatedAt: staleSince,
  })
  resources.delete('PersistentVolume/volume')
  resources.delete('PersistentVolume/workspace-volume')
  for (let round = 0; round < 5; round += 1) await tick()
  expect(job.placements.map((placement) => placement.state)).toEqual(['deleted', 'abandoned'])
  expect(memory.rows('claude_code_runtimes').find((row) => row._id === 'orphan')!.status).toBe(
    'disabled',
  )
  expect(job.completedAt).toBeInstanceOf(Date)
  expect(hostedRow()).toHaveLength(0)
})

test('an environment that is still reconciling keeps its placement', async () => {
  job.requestedAt = new Date(Date.now() - RUNTIME_CONTROLLER_STALE_MS - 60_000)
  job.placements.push({
    id: 'other-placement',
    url: elsewhere('other-environment'),
    state: 'pending',
  })
  memory.rows('agent_runtime_controllers').push({
    _id: 'claude-code:other-environment',
    seenAt: new Date(),
  })
  await tick()
  expect(job.placements[1]!.state).toBe('pending')
  expect(job.completedAt).toBeUndefined()
})

test('placement namespaces are read from the runtime URL', () => {
  expect(placementNamespace(elsewhere('openab-runtimes-dev'))).toBe('openab-runtimes-dev')
  expect(placementNamespace('wss://runtime.example.com/acp')).toBeUndefined()
})

test('deletion does not wait for an active conversation or back up its workspace', async () => {
  await tick()
  expect(actions).toEqual(['delete:Deployment'])
  expect(job.error).toBeUndefined()
})
