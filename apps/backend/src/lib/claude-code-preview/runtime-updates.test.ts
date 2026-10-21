import { afterAll, beforeEach, expect, test } from 'bun:test'

import { config } from '@/config'
import { useProvisionerKube } from '@/lib/test/doubles/provisioner-kube'

import { hostedRuntimeName, hostedRuntimeUrl } from './runtime-objects'
import {
  publishedRuntimeImage,
  publishRuntimeRelease,
  restoreRuntimeReleases,
} from './runtime-release-testing'
import { runtimeUpdateStatus } from './runtime-updates'

import type { KubeResourceState } from './kube-client'
import type { ClaudeCodeRuntimeDoc } from './runtime-registry'

const teamId = '123456789012345678901234'
const runtimeId = 'joined-runtime'
const namespace = config.claudeCodeRuntimeProvisioner.namespace
const image = publishedRuntimeImage('0.3.1', 'claude-code')
let deployment: KubeResourceState | null

useProvisionerKube({
  provisionerKubeClient: () => ({
    apply: async () => {},
    createIfAbsent: async () => true,
    getSecret: async () => null,
    getResource: async () => deployment,
    delete: async () => {},
  }),
})
afterAll(restoreRuntimeReleases)

const joined = { userId: 'owner', deviceId: 'device' }

function rollout(replicas: number, updated: number): KubeResourceState {
  return {
    metadata: { uid: 'deployment', generation: 2 },
    status: {
      observedGeneration: 2,
      replicas,
      updatedReplicas: updated,
      availableReplicas: replicas,
    },
    spec: { template: { spec: { containers: [{ name: 'openab', image }] } } },
  }
}

function hosted(device?: ClaudeCodeRuntimeDoc['device']): ClaudeCodeRuntimeDoc {
  return {
    _id: runtimeId,
    teamId,
    url: hostedRuntimeUrl(hostedRuntimeName(teamId, 'claude-code', runtimeId), namespace),
    hostedBy: 'nuphos',
    status: 'active',
    requestedRuntimeVersion: '0.3.1',
    deploymentImage: image,
    ...(device ? { device } : {}),
    createdByUserId: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

beforeEach(async () => {
  deployment = rollout(1, 1)
  await publishRuntimeRelease({ version: '0.3.1' })
})

// Regression: a joined pod serves no /statusz, so its version never arrived and an applied
// update read as "updating" forever.
test('a joined runtime is current once its device is online on the rolled-out image', async () => {
  expect(await runtimeUpdateStatus('claude-code', hosted(joined), { online: true })).toMatchObject({
    state: 'current',
    currentVersion: '0.3.1',
  })
})

test('a joined runtime keeps updating while an older pod still serves', async () => {
  deployment = rollout(2, 1)

  expect((await runtimeUpdateStatus('claude-code', hosted(joined), { online: true })).state).toBe(
    'updating',
  )
})

test('a joined runtime keeps updating until its device comes online', async () => {
  expect((await runtimeUpdateStatus('claude-code', hosted(joined), { online: false })).state).toBe(
    'updating',
  )
})

test('a directly dialled runtime still reports the version its status page served', async () => {
  expect(
    await runtimeUpdateStatus('claude-code', hosted(), { online: true, runtimeVersion: '0.3.1' }),
  ).toMatchObject({ state: 'current', currentVersion: '0.3.1' })
})
