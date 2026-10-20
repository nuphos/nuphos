import { randomBytes } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { publishRuntimeRelease, restoreRuntimeReleases } from './runtime-release-testing'

import type { KubeClient } from './kube-client'
import type { KubeObject } from './runtime-objects'
import type { ClaudeCodeRuntimeDoc } from './runtime-registry'

const previous = {
  key: config.claudeCodePreview.tokenEncryptionKey,
  backendUrl: config.agent.backendUrl,
}

config.claudeCodePreview.tokenEncryptionKey = randomBytes(32).toString('base64')
config.agent.backendUrl = 'https://api.nuphos.example'
afterAll(() => {
  config.claudeCodePreview.tokenEncryptionKey = previous.key
  config.agent.backendUrl = previous.backendUrl
  restoreRuntimeReleases()
})

let store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })

const { reconcileHostedRuntimes } = await import('./runtime-provisioner')
const { createManagedRuntimeInstance } = await import('./runtime-instances')
const { resolveTeamRuntimeEndpoints } = await import('./runtime-registry')
const { detachHostedRuntimeDevice, joinHostedRuntimeAsDevice } =
  await import('./runtime-device-join')

type Container = {
  env: { name: string; value?: string; valueFrom?: unknown }[]
  readinessProbe?: unknown
  livenessProbe?: unknown
}
type Deployment = KubeObject & { spec: { template: { spec: { containers: Container[] } } } }
type Secret = KubeObject & { stringData: Record<string, string> }

function fakeKube() {
  const applied: KubeObject[] = []
  const kube: KubeClient = {
    apply: (resource) => {
      applied.push(resource)

      return Promise.resolve()
    },
    createIfAbsent: () => Promise.resolve(true),
    getResource: () => Promise.resolve(null),
    getSecret: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  }
  const last = <T extends KubeObject>(kind: string) =>
    applied.filter((resource) => resource.kind === kind).at(-1) as T

  return { kube, last }
}

async function reconcile(provider: 'claude-code' | 'codex' = 'claude-code') {
  const { kube, last } = fakeKube()

  await reconcileHostedRuntimes({
    kube,
    namespace: config.claudeCodeRuntimeProvisioner.namespace,
    provider,
    hasActiveRuntimeTurn: () => Promise.resolve(false),
  })

  return {
    secret: last<Secret>('Secret').stringData,
    container: last<Deployment>('Deployment').spec.template.spec.containers[0]!,
  }
}

const row = () => store.rows('claude_code_runtimes')[0] as ClaudeCodeRuntimeDoc
const tokens = () => store.rows('agent_device_join_tokens') as { expiresAt: Date }[]
const devices = () => store.rows('agent_devices') as { credentialHash?: string }[]

beforeEach(async () => {
  store = portabilityDb()
  await publishRuntimeRelease({ version: '0.3.1' })
})

describe('a hosted runtime that joins as a device', () => {
  test('its pod starts as the CLI host and its endpoint is the device tunnel', async () => {
    const agent = await createManagedRuntimeInstance({
      teamId: 'team-a',
      userId: 'admin',
      provider: 'claude-code',
      label: 'Agent',
    })
    const device = await joinHostedRuntimeAsDevice('team-a', agent.id)
    const { secret, container } = await reconcile()

    expect(secret.NUPHOS_JOIN_TOKEN).toStartWith('nbj_')
    expect(container.env).toContainEqual({
      name: 'NUPHOS_JOIN_TOKEN',
      valueFrom: { secretKeyRef: { name: expect.any(String), key: 'NUPHOS_JOIN_TOKEN' } },
    })
    expect(container.env).toContainEqual({
      name: 'NUPHOS_API_URL',
      value: 'https://api.nuphos.example',
    })
    expect(container.env).toContainEqual({ name: 'NUPHOS_AGENT_OWNER_ID', value: 'admin' })
    // The host serves nothing on openab's port, so nothing probes it.
    expect(container.readinessProbe).toBeUndefined()
    expect(container.livenessProbe).toBeUndefined()
    expect((await resolveTeamRuntimeEndpoints('team-a'))[0]?.tunnelUrl).toBe(
      `nuphos-device://runtime/admin/${device.deviceId}?team=team-a`,
    )
    // Joining twice is the same device.
    expect(await joinHostedRuntimeAsDevice('team-a', agent.id)).toEqual(device)
    expect(devices()).toHaveLength(1)
  })

  test('keeps its token across restarts, and replaces one that died before the device joined', async () => {
    const agent = await createManagedRuntimeInstance({
      teamId: 'team-a',
      userId: 'admin',
      provider: 'codex',
      label: 'Agent',
    })

    await joinHostedRuntimeAsDevice('team-a', agent.id)
    const first = (await reconcile('codex')).secret.NUPHOS_JOIN_TOKEN

    expect((await reconcile('codex')).secret.NUPHOS_JOIN_TOKEN).toBe(first)
    for (const token of tokens()) token.expiresAt = new Date(0)
    const second = (await reconcile('codex')).secret.NUPHOS_JOIN_TOKEN

    expect(second).not.toBe(first)
    // Once the device has joined, the used token stays: the host has its credential.
    devices()[0]!.credentialHash = 'hash'
    for (const token of tokens()) token.expiresAt = new Date(0)
    expect((await reconcile('codex')).secret.NUPHOS_JOIN_TOKEN).toBe(second)
  })

  test('detaching restores the direct connection and forgets the device', async () => {
    const agent = await createManagedRuntimeInstance({
      teamId: 'team-a',
      userId: 'admin',
      provider: 'claude-code',
      label: 'Agent',
    })

    await joinHostedRuntimeAsDevice('team-a', agent.id)
    await reconcile()
    expect(await detachHostedRuntimeDevice('team-a', agent.id)).toBe(true)
    const { secret, container } = await reconcile()

    expect(secret.NUPHOS_JOIN_TOKEN).toBeUndefined()
    expect(container.env.map((entry) => entry.name)).not.toContain('NUPHOS_JOIN_TOKEN')
    expect(container.readinessProbe).toBeDefined()
    expect(row().device).toBeUndefined()
    expect(devices()).toHaveLength(0)
    expect(tokens()).toHaveLength(0)
    expect((await resolveTeamRuntimeEndpoints('team-a'))[0]?.tunnelUrl).toBeUndefined()
    expect(await detachHostedRuntimeDevice('team-a', agent.id)).toBe(false)
  })

  test('a provider the CLI host cannot run never joins', async () => {
    const agent = await createManagedRuntimeInstance({
      teamId: 'team-a',
      userId: 'admin',
      provider: 'grok',
      label: 'Agent',
    })

    await expect(joinHostedRuntimeAsDevice('team-a', agent.id)).rejects.toThrow('cannot join')
  })
})
