import { randomBytes } from 'node:crypto'

import { OPENAB_PROVIDERS } from './runtime-provider'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { hostedRuntimeDeploymentObject } from './runtime-deployment'
import {
  hostedRuntimeName,
  hostedRuntimeUrl,
  runtimeAuthSecretName,
  runtimeConfigMapObject,
} from './runtime-objects'
import {
  publishedRuntimeImage,
  runtimeFeedRequests,
  publishRuntimeRelease,
  restoreRuntimeReleases,
} from './runtime-release-testing'
import { TEMPLATE_ROLLOUTS_PER_TICK } from './runtime-rollout'

import type { KubeClient, KubeResourceState } from './kube-client'
import type { RuntimeScheduling } from './runtime-deployment'
import type { KubeObject } from './runtime-objects'
import type { OpenAbProvider } from './runtime-provider'

const provisioner = config.claudeCodeRuntimeProvisioner
const original = { ...provisioner }
const previousKey = config.claudeCodePreview.tokenEncryptionKey

config.claudeCodePreview.tokenEncryptionKey = randomBytes(32).toString('base64')
afterAll(() => {
  config.claudeCodePreview.tokenEncryptionKey = previousKey
  Object.assign(provisioner, original)
  restoreRuntimeReleases()
})

const FLEET_VERSION = '0.3.1'

let store = portabilityDb()

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })

const { reconcileHostedRuntimes } = await import('./runtime-provisioner')
const { createManagedRuntimeInstance } = await import('./runtime-instances')
const { requestRuntimeUpdate } = await import('./runtime-updates')
const { registerTeamRuntime, resolveTeamRuntimeEndpoints, setTeamRuntimeStatus } =
  await import('./runtime-registry')

type PodSpec = {
  initContainers?: unknown[]
  containers: {
    image: string
    env: { name: string; value?: string; valueFrom?: unknown }[]
    envFrom?: unknown
  }[]
  volumes: Record<string, unknown>[]
}
type Deployment = KubeObject & { spec: { replicas: number; template: { spec: PodSpec } } }
type FakeKube = KubeClient & { applied: KubeObject[] }

/** Serves applied objects back, the way the API server does on the next tick. */
function fakeKube(): FakeKube {
  const applied: KubeObject[] = []
  const state = new Map<string, KubeObject>()
  const put = (resource: KubeObject) => {
    applied.push(resource)
    state.set(`${resource.kind}/${resource.metadata.name}`, resource)
  }

  return {
    applied,
    apply: (resource) => {
      put(resource)

      return Promise.resolve()
    },
    createIfAbsent: (resource) => {
      if (state.has(`${resource.kind}/${resource.metadata.name}`)) return Promise.resolve(false)
      put(resource)

      return Promise.resolve(true)
    },
    getResource: (resource) => {
      const match = state.get(`${resource.kind}/${resource.metadata.name}`)

      return Promise.resolve(
        match
          ? {
              metadata: { uid: `${match.metadata.name}-uid` },
              spec: match.spec as KubeResourceState['spec'],
            }
          : null,
      )
    },
    getSecret: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  }
}

const namespace = () => provisioner.namespace
const idle = () => Promise.resolve(false)

function reconcile(
  kube: FakeKube,
  provider: OpenAbProvider = 'claude-code',
  overrides: { scheduling?: RuntimeScheduling; hasActiveRuntimeTurn?: () => Promise<boolean> } = {},
) {
  return reconcileHostedRuntimes({
    kube,
    namespace: namespace(),
    provider,
    hasActiveRuntimeTurn: idle,
    ...overrides,
  })
}

const addAgent = (provider: OpenAbProvider = 'claude-code', teamId = 'team-a') =>
  createManagedRuntimeInstance({ teamId, userId: 'admin', provider, label: 'Agent' })

const ofKind = <T extends KubeObject>(kube: FakeKube, kind: string) =>
  kube.applied.filter((resource) => resource.kind === kind) as T[]

beforeEach(async () => {
  store = portabilityDb()
  Object.assign(provisioner, original)
  await publishRuntimeRelease({ version: FLEET_VERSION })
})

describe('runtime object builders', () => {
  test.each(['codex', 'claude-code'] as const)(
    '%s agents receive memory budgets across env_clear',
    (provider) => {
      const data = runtimeConfigMapObject('openab-runtimes', provider).data as Record<
        string,
        string
      >
      const parsed = Bun.TOML.parse(data['config.toml']!) as {
        agent: { env: Record<string, string>; inherit_env?: string[] }
        pool: { max_sessions: number; session_ttl_hours: number }
      }

      // Per-tool budgets stay well under the container limit: the cgroup runs
      // with memory.oom.group=1, so one tool reaching it kills every pooled session.
      expect(parsed.agent.env.GOMEMLIMIT).toBe('1536MiB')
      expect(parsed.agent.env.NODE_OPTIONS).toBe('--max-old-space-size=1536')
      expect(parsed.agent.env.GOFLAGS).toBe('-p=2')
      expect(parsed.agent.env.MAKEFLAGS).toBe('-j2')
      expect(parsed.agent.env.BASH_ENV).toBe('/opt/nuphos-runtime/runtime-guard.sh')
      expect(parsed.pool.max_sessions).toBe(8)
      expect(parsed.pool.session_ttl_hours).toBe(4)
      expect(parsed.agent.inherit_env).toBeUndefined()
    },
  )

  test('codex keeps full access when a pooled session is restored, not only when created', () => {
    const data = runtimeConfigMapObject('openab-runtimes', 'codex').data as Record<string, string>
    const parsed = Bun.TOML.parse(data['config.toml']!) as {
      agent: { env: Record<string, string> }
      pool: Record<string, unknown>
    }

    expect(parsed.agent.env.INITIAL_AGENT_MODE).toBe('agent-full-access')
    expect(parsed.pool.default_config_options).toBeUndefined()
  })

  test('pod isolation: node pool pinning, seccomp, and the CPU ceiling', () => {
    const podSpec = (scheduling?: RuntimeScheduling) =>
      (
        hostedRuntimeDeploymentObject({
          name: 'openab-claude-x',
          teamId: 'team-a',
          runtimeId: 'runtime-1',
          namespace: 'openab-runtimes',
          image: 'img:1',
          provider: 'claude-code',
          running: true,
          ...(scheduling ? { scheduling } : {}),
        }) as unknown as {
          spec: {
            template: {
              spec: {
                nodeSelector?: Record<string, string>
                tolerations?: Record<string, string>[]
                securityContext: { seccompProfile?: { type: string } }
                containers: { resources: { limits: Record<string, string> } }[]
              }
            }
          }
        }
      ).spec.template.spec
    const isolated = podSpec({
      nodeSelector: { 'cloud.google.com/gke-nodepool': 'pool-runtime' },
      tolerations: [{ key: 'nuphos.ai/runtime', value: 'true' }],
      cpuLimit: '4',
    })

    expect(isolated.nodeSelector).toEqual({ 'cloud.google.com/gke-nodepool': 'pool-runtime' })
    expect(isolated.tolerations).toEqual([
      { key: 'nuphos.ai/runtime', operator: 'Equal', value: 'true', effect: 'NoSchedule' },
    ])
    expect(isolated.containers[0]?.resources.limits).toEqual({ memory: '8Gi', cpu: '4' })
    expect(isolated.securityContext.seccompProfile).toEqual({ type: 'RuntimeDefault' })

    const unpinned = podSpec()

    expect(unpinned.nodeSelector).toBeUndefined()
    expect(unpinned.tolerations).toBeUndefined()
    expect(unpinned.containers[0]?.resources.limits).toEqual({ memory: '8Gi' })
  })
})

describe('reconcileHostedRuntimes', () => {
  test.each([...OPENAB_PROVIDERS])(
    'deploys a %s agent as the self-hosted image started with its own password',
    async (provider) => {
      const agent = await addAgent(provider)
      const kube = fakeKube()

      await reconcile(kube, provider)
      const name = hostedRuntimeName('team-a', provider, agent.id)
      // Agents without a patched adapter start behind the ACP shim.
      if (provider === 'grok' || provider === 'antigravity')
        expect(
          ofKind<KubeObject & { data: Record<string, string> }>(kube, 'ConfigMap')[0]?.data[
            'config.toml'
          ],
        ).toContain(`command = "node"\nargs = ["/opt/acp-shim.mjs", "${provider}"]`)
      const secretName = runtimeAuthSecretName('team-a', agent.id)

      expect(kube.applied.map((resource) => resource.kind)).toEqual([
        'ConfigMap',
        'Secret',
        'PersistentVolumeClaim',
        'PersistentVolumeClaim',
        'Deployment',
        'Service',
      ])
      const [endpoint] = await resolveTeamRuntimeEndpoints('team-a', undefined, provider)
      const [secret] = ofKind<KubeObject & { stringData: Record<string, string> }>(kube, 'Secret')

      expect(secret?.metadata.name).toBe(secretName)
      expect(secret?.stringData).toEqual({ OPENAB_ACP_AUTH_KEY: endpoint!.authKey })
      expect(ofKind(kube, 'PersistentVolumeClaim').map((claim) => claim.metadata.name)).toEqual([
        `${name}-home`,
        `${name}-workspace`,
      ])
      const [service] = ofKind<KubeObject & { spec: { publishNotReadyAddresses?: boolean } }>(
        kube,
        'Service',
      )

      expect(service?.metadata.name).toBe(name)
      // The first sign-in connects as soon as the pod listens, not after its readiness probe.
      expect(service?.spec.publishNotReadyAddresses).toBe(true)
      expect(endpoint?.url).toBe(hostedRuntimeUrl(name, namespace()))

      const [deployment] = ofKind<Deployment>(kube, 'Deployment')
      const pod = deployment!.spec.template.spec
      const container = pod.containers[0]!

      expect(deployment?.metadata.name).toBe(name)
      expect(deployment?.spec.replicas).toBe(1)
      expect(container.image).toBe(publishedRuntimeImage(FLEET_VERSION, provider))
      expect(pod.initContainers).toBeUndefined()
      expect(container.envFrom).toBeUndefined()
      expect(container.env).toContainEqual({
        name: 'OPENAB_ACP_AUTH_KEY',
        valueFrom: { secretKeyRef: { name: secretName, key: 'OPENAB_ACP_AUTH_KEY' } },
      })
      expect(container.env).toContainEqual({ name: 'OPENAB_RUNTIME_CONSOLE', value: 'false' })
      // Both the login and every conversation's files outlive the pod.
      expect(pod.volumes).toContainEqual({
        name: 'home',
        persistentVolumeClaim: { claimName: `${name}-home` },
      })
      expect(pod.volumes).toContainEqual({
        name: 'workspace',
        persistentVolumeClaim: { claimName: `${name}-workspace` },
      })
      expect(pod.volumes.some((volume) => 'emptyDir' in volume)).toBe(false)
      // The image derives the operator key from the password, as for any self-hosted runtime.
      expect(container.env.map((entry) => entry.name)).not.toContain('OPENAB_ACP_CONTROL_KEY')
      expect(container.env.map((entry) => entry.name)).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    },
  )

  test('a disabled agent keeps its objects but runs no pod', async () => {
    const agent = await addAgent()

    await setTeamRuntimeStatus('team-a', agent.id, 'disabled')
    const kube = fakeKube()

    await reconcile(kube)

    expect(ofKind<Deployment>(kube, 'Deployment')[0]?.spec.replicas).toBe(0)
  })

  test('deploys only its own namespace, never a self-hosted runtime, never one being deleted', async () => {
    await registerTeamRuntime({
      teamId: 'team-a',
      userId: 'admin',
      url: 'ws://openab-claude-other.another-namespace.svc:8080/acp',
      authKey: 'foreign-password',
      hostedBy: 'nuphos',
    })
    await registerTeamRuntime({
      teamId: 'team-a',
      userId: 'admin',
      url: 'wss://self-hosted.example/acp',
      authKey: 'self-hosted-password',
    })
    const deleting = await addAgent()

    store.rows('agent_runtime_deletions').push({
      _id: deleting.id,
      teamId: 'team-a',
      provider: 'claude-code',
      placements: [],
      completedAt: new Date(),
    })
    const kube = fakeKube()

    await reconcile(kube)

    expect(kube.applied.map((resource) => resource.kind)).toEqual(['ConfigMap'])
  })

  test('a new release never changes an existing runtime image', async () => {
    await addAgent()
    const kube = fakeKube()

    await reconcile(kube)
    await publishRuntimeRelease({ version: '9.9.9' })
    kube.applied.length = 0
    await reconcile(kube, 'claude-code', { hasActiveRuntimeTurn: () => Promise.resolve(true) })

    expect(ofKind<Deployment>(kube, 'Deployment')[0]?.spec.template.spec.containers[0]?.image).toBe(
      publishedRuntimeImage(FLEET_VERSION, 'claude-code'),
    )
    expect(runtimeFeedRequests()).toBe(1)
  })

  test('an unchanged template never asks the runtime whether it is busy', async () => {
    await addAgent()
    const kube = fakeKube()

    await reconcile(kube)
    let asked = 0

    await reconcile(kube, 'claude-code', {
      hasActiveRuntimeTurn: () => {
        asked += 1

        return Promise.resolve(false)
      },
    })

    expect(asked).toBe(0)
  })

  test('rolls out a fleet-wide change a few runtimes per tick', async () => {
    for (let index = 0; index < 5; index++) await addAgent('claude-code', `team-${String(index)}`)
    const kube = fakeKube()

    await reconcile(kube)
    const rolled = new Set<string>()
    const tick = async () => {
      kube.applied.length = 0
      await reconcile(kube, 'claude-code', {
        scheduling: { nodeSelector: { pool: 'runtime' }, tolerations: [] },
      })
      for (const deployment of ofKind(kube, 'Deployment')) rolled.add(deployment.metadata.name)
    }

    await tick()
    expect(rolled.size).toBe(TEMPLATE_ROLLOUTS_PER_TICK)
    await tick()
    expect(rolled.size).toBe(5)
  })

  test('creates the home claim once and leaves an existing one untouched', async () => {
    await addAgent()
    const kube = fakeKube()

    await reconcile(kube)
    kube.applied.length = 0
    await reconcile(kube)

    expect(ofKind(kube, 'PersistentVolumeClaim')).toEqual([])
  })

  test('a failing home volume step still reconciles the Deployment', async () => {
    await addAgent()
    const kube = fakeKube()

    const getResource = kube.getResource!.bind(kube)

    kube.getResource = (resource) =>
      resource.kind === 'PersistentVolumeClaim'
        ? Promise.reject(new Error('persistentvolumeclaims quota exceeded'))
        : getResource(resource)
    await reconcile(kube)

    expect(kube.applied.map((resource) => resource.kind)).toEqual([
      'ConfigMap',
      'Secret',
      'Deployment',
      'Service',
    ])
  })
})

test('an individual requested release waits for idle and persists on later reconcile ticks', async () => {
  // The registry serves the pinned release too; an unpublished one is covered in
  // runtime-image.test.ts.
  await publishRuntimeRelease({ version: FLEET_VERSION, published: [FLEET_VERSION, '9.9.9'] })
  const agent = await addAgent()
  const kube = fakeKube()

  await reconcile(kube)
  await publishRuntimeRelease({ version: '9.9.9' })
  provisioner.enabled = true
  provisioner.kubectl = true
  await requestRuntimeUpdate('team-a', agent)
  kube.applied.length = 0
  await reconcile(kube, 'claude-code', { hasActiveRuntimeTurn: () => Promise.resolve(true) })
  expect(ofKind(kube, 'Deployment')).toEqual([])
  await reconcile(kube)
  expect(
    ofKind<Deployment>(kube, 'Deployment').at(-1)?.spec.template.spec.containers[0]?.image,
  ).toBe(publishedRuntimeImage('9.9.9', 'claude-code'))
  kube.applied.length = 0
  await reconcile(kube)
  expect(
    ofKind<Deployment>(kube, 'Deployment').at(-1)?.spec.template.spec.containers[0]?.image,
  ).toBe(publishedRuntimeImage('9.9.9', 'claude-code'))
})

test('legacy tags are adopted verbatim and retained through feed outages and pod recreation', async () => {
  const agent = await addAgent()
  const kube = fakeKube()

  await reconcile(kube)
  const deployment = ofKind<Deployment>(kube, 'Deployment').at(-1)!
  const legacyImage = 'ghcr.io/zeabur/nuphos-runtime:0.1.13-claude-code'

  deployment.spec.template.spec.containers[0]!.image = legacyImage
  await kube.apply(deployment, 'legacy-provisioner')
  await store
    .collection('claude_code_runtimes')
    .updateOne(
      { _id: agent.id },
      { $unset: { deploymentImage: '' }, $set: { requestedRuntimeVersion: '0.1.13' } },
    )
  await publishRuntimeRelease({})
  await reconcile(kube)
  expect(
    ofKind<Deployment>(kube, 'Deployment').at(-1)!.spec.template.spec.containers[0]!.image,
  ).toBe(legacyImage)
  const replacement = fakeKube()

  await reconcile(replacement)
  expect(
    ofKind<Deployment>(replacement, 'Deployment').at(-1)!.spec.template.spec.containers[0]!.image,
  ).toBe(legacyImage)
  expect(runtimeFeedRequests()).toBe(1)
})

test('a legacy pending Update survives migration and waits for idle', async () => {
  const agent = await addAgent()
  const kube = fakeKube()

  await reconcile(kube)
  await publishRuntimeRelease({ version: '9.9.9' })
  await store
    .collection('claude_code_runtimes')
    .updateOne(
      { _id: agent.id },
      { $unset: { deploymentImage: '' }, $set: { requestedRuntimeVersion: '9.9.9' } },
    )
  kube.applied.length = 0
  await reconcile(kube, 'claude-code', { hasActiveRuntimeTurn: () => Promise.resolve(true) })
  expect(ofKind(kube, 'Deployment')).toEqual([])
  const selected = await store.collection('claude_code_runtimes').findOne({ _id: agent.id })

  expect(selected?.deploymentImage).toBe(publishedRuntimeImage('9.9.9', 'claude-code'))
  // Once selected, the pending Update no longer needs the release feed.
  await publishRuntimeRelease({})
  await reconcile(kube)
  expect(
    ofKind<Deployment>(kube, 'Deployment').at(-1)!.spec.template.spec.containers[0]!.image,
  ).toBe(publishedRuntimeImage('9.9.9', 'claude-code'))
  const requests = runtimeFeedRequests()

  await reconcile(kube)
  expect(runtimeFeedRequests()).toBe(requests)
})

test('an unavailable legacy pending Update is retried without adopting the old image', async () => {
  const agent = await addAgent()
  const kube = fakeKube()

  await reconcile(kube)
  await store
    .collection('claude_code_runtimes')
    .updateOne(
      { _id: agent.id },
      { $unset: { deploymentImage: '' }, $set: { requestedRuntimeVersion: '9.9.9' } },
    )
  await publishRuntimeRelease({ version: '9.9.9', published: [] })
  kube.applied.length = 0
  await reconcile(kube)
  const selected = await store.collection('claude_code_runtimes').findOne({ _id: agent.id })

  expect(selected?.deploymentImage).toBeUndefined()
  expect(selected?.requestedRuntimeVersion).toBe('9.9.9')
  expect(selected?.runtimeUpdateError).toBeDefined()
  expect(ofKind(kube, 'Deployment')).toEqual([])
  await publishRuntimeRelease({ version: '9.9.9' })
  await reconcile(kube)
  expect(
    ofKind<Deployment>(kube, 'Deployment').at(-1)!.spec.template.spec.containers[0]!.image,
  ).toBe(publishedRuntimeImage('9.9.9', 'claude-code'))
})

test('an unpublished explicit update leaves the selected image unchanged', async () => {
  const agent = await addAgent()
  const before = await store.collection('claude_code_runtimes').findOne({ _id: agent.id })

  await publishRuntimeRelease({ version: '9.9.9', published: [] })
  provisioner.enabled = true
  provisioner.kubectl = true
  await expect(requestRuntimeUpdate('team-a', agent)).rejects.toThrow(
    'release image is unavailable',
  )
  const after = await store.collection('claude_code_runtimes').findOne({ _id: agent.id })

  expect(after?.deploymentImage).toBe(before?.deploymentImage)
  expect(after?.requestedRuntimeVersion).toBeUndefined()
})
