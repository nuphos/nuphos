import { randomBytes } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'
import {
  decryptDatabaseCredentialWithKey,
  encryptDatabaseCredentialWithKey,
} from '@/lib/database-credentials'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import {
  RUNTIME_AUTH_SECRET_KEY,
  readRuntimeAuthSecret,
  readRuntimeControlSecret,
} from './runtime-credential-secret'
import { deriveRuntimeControlKey } from './runtime-control-key'
import { runtimeAuthSecretName } from './runtime-objects'

import type { KubeClient } from './kube-client'
import type { KubeObject } from './runtime-objects'
import type { ClaudeCodeRuntimeDoc } from './runtime-registry'

const previousKey = config.claudeCodePreview.tokenEncryptionKey

config.claudeCodePreview.tokenEncryptionKey = randomBytes(32).toString('base64')
afterAll(() => {
  config.claudeCodePreview.tokenEncryptionKey = previousKey
})
const MASTER_KEY = {
  raw: config.claudeCodePreview.tokenEncryptionKey,
  keyId: 'claude-code-preview',
}

let store = portabilityDb()
let docs = store.rows('claude_code_runtimes') as ClaudeCodeRuntimeDoc[]

const secrets = new Map<string, Record<string, string>>()
const secretMapKey = (namespace: string, name: string) => `${namespace}/${name}`
const kube: KubeClient = {
  createIfAbsent: (resource: KubeObject) => {
    const mapKey = secretMapKey(resource.metadata.namespace, resource.metadata.name)

    if (secrets.has(mapKey)) return Promise.resolve(false)
    const secret = resource as KubeObject & { stringData?: Record<string, string> }

    if (secret.stringData) secrets.set(mapKey, secret.stringData)

    return Promise.resolve(true)
  },
  apply: (resource: KubeObject) => {
    if (resource.kind === 'Secret') {
      const secret = resource as KubeObject & { stringData?: Record<string, string> }

      if (secret.stringData)
        secrets.set(
          secretMapKey(resource.metadata.namespace, resource.metadata.name),
          secret.stringData,
        )
    }

    return Promise.resolve()
  },
  getSecret: (namespace, name) =>
    Promise.resolve(secrets.get(secretMapKey(namespace, name)) ?? null),
  delete: (resource) => {
    if (resource.kind === 'Secret')
      secrets.delete(secretMapKey(resource.metadata.namespace, resource.metadata.name))

    return Promise.resolve()
  },
}

/** Seeds a Secret the way a provisioner or an older release left one behind. */
function seedRuntimeSecret(
  teamId: string,
  runtimeId: string,
  data: Record<string, string>,
  namespace = config.claudeCodeRuntimeProvisioner.namespace,
) {
  secrets.set(secretMapKey(namespace, runtimeAuthSecretName(teamId, runtimeId)), data)
}

useDb({ db: () => ({ collection: (name: string) => store.collection(name) }) })

const {
  listTeamRuntimes,
  registerTeamRuntime,
  removeTeamRuntime,
  resolveTeamRuntimeEndpoints,
  setTeamRuntimeStatus,
} = await import('./runtime-registry')
const { rotateRuntimeKeys } = await import('./runtime-registry-credentials')

beforeEach(() => {
  store = portabilityDb()
  docs = store.rows('claude_code_runtimes') as ClaudeCodeRuntimeDoc[]
  secrets.clear()
})

describe('runtime registry', () => {
  test('register + resolve round-trips the transport key without exposing it publicly', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'ws://openab-team-1.production.svc:8080/acp',
      authKey: 'transport-key-1',
      label: 'primary',
      kube,
    })

    expect(runtime.url).toBe('ws://openab-team-1.production.svc:8080/acp')
    expect(JSON.stringify(runtime)).not.toContain('transport-key-1')

    const endpoints = await resolveTeamRuntimeEndpoints('team-1', kube)

    expect(endpoints).toEqual([
      {
        url: 'ws://openab-team-1.production.svc:8080/acp',
        authKey: 'transport-key-1',
        runtimeId: runtime.id,
      },
    ])
    // Unmanaged but still in-cluster, so it keeps the Service backend URL.
    expect(endpoints[0]?.external).toBeUndefined()
    expect(docs[0]?.authKeyEnvelope).toBeDefined()
    expect(secrets.size).toBe(0)
  })

  test('registers an external runtime with no Kubernetes connection at all', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://external.example/acp',
      authKey: 'external-key',
      label: 'my VPS',
    })

    expect(runtime.label).toBe('my VPS')
    expect(await resolveTeamRuntimeEndpoints('team-1')).toEqual([
      {
        url: 'wss://external.example/acp',
        authKey: 'external-key',
        runtimeId: runtime.id,
        external: true,
      },
    ])
  })

  test('on a local stack, a local runtime registers as internal', async () => {
    const localStack = config.localStack

    try {
      config.localStack = true
      const runtime = await registerTeamRuntime({
        teamId: 'team-1',
        userId: 'user-1',
        url: 'ws://runtime:8080/acp',
        authKey: 'compose-key',
      })

      const local = await registerTeamRuntime({
        teamId: 'team-1',
        userId: 'user-1',
        url: 'ws://localhost:18180/acp',
        authKey: 'compose-key',
      })

      expect(await resolveTeamRuntimeEndpoints('team-1')).toEqual([
        { url: 'ws://runtime:8080/acp', authKey: 'compose-key', runtimeId: runtime.id },
        { url: 'ws://localhost:18180/acp', authKey: 'compose-key', runtimeId: local.id },
      ])

      config.localStack = false
      await expect(
        registerTeamRuntime({
          teamId: 'team-2',
          userId: 'user-1',
          url: 'ws://runtime:8080/acp',
          authKey: 'compose-key',
        }),
      ).rejects.toMatchObject({ code: 'invalid_runtime_url' })
    } finally {
      config.localStack = localStack
    }
  })

  test('a team resolves to all its active runtimes, oldest first', async () => {
    await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab-a.example/acp',
      authKey: 'key-a',
      kube,
    })
    await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab-b.example/acp',
      authKey: 'key-b',
      kube,
    })
    await registerTeamRuntime({
      teamId: 'team-2',
      userId: 'user-1',
      url: 'wss://openab-other.example/acp',
      authKey: 'key-c',
      kube,
    })

    const endpoints = await resolveTeamRuntimeEndpoints('team-1', kube)

    expect(endpoints.map((endpoint) => endpoint.url)).toEqual([
      'wss://openab-a.example/acp',
      'wss://openab-b.example/acp',
    ])
  })

  test('a disabled runtime stays listed but stops resolving', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'key-a',
      kube,
    })

    const updated = await setTeamRuntimeStatus('team-1', runtime.id, 'disabled')

    expect(updated?.status).toBe('disabled')
    expect(await resolveTeamRuntimeEndpoints('team-1', kube)).toEqual([])
    expect((await listTeamRuntimes('team-1')).map((item) => item.status)).toEqual(['disabled'])
  })

  test('an envelope in Mongo resolves without touching Kubernetes', async () => {
    const now = new Date()

    docs.push({
      _id: 'stored-runtime',
      teamId: 'team-1',
      url: 'wss://stored.example/acp',
      status: 'active',
      authKeyEnvelope: encryptDatabaseCredentialWithKey('stored-key', MASTER_KEY),
      createdByUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    })

    expect(await resolveTeamRuntimeEndpoints('team-1')).toEqual([
      {
        url: 'wss://stored.example/acp',
        authKey: 'stored-key',
        runtimeId: 'stored-runtime',
        external: true,
      },
    ])
    expect(docs[0]?.authKeyEnvelope).toBeDefined()
  })

  test('a runtime whose key is only in a Secret keeps working and is adopted into Mongo', async () => {
    const now = new Date()

    docs.push({
      _id: 'secret-only',
      teamId: 'team-1',
      url: 'wss://secret-only.example/acp',
      status: 'active',
      createdByUserId: 'user-1',
      createdAt: now,
      updatedAt: now,
    })
    seedRuntimeSecret('team-1', 'secret-only', { [RUNTIME_AUTH_SECRET_KEY]: 'secret-key' })

    expect(await resolveTeamRuntimeEndpoints('team-1', kube)).toEqual([
      {
        url: 'wss://secret-only.example/acp',
        authKey: 'secret-key',
        runtimeId: 'secret-only',
        external: true,
      },
    ])

    const adopted = docs[0]?.authKeyEnvelope

    expect(adopted).toBeDefined()
    expect(decryptDatabaseCredentialWithKey(adopted!, MASTER_KEY)).toBe('secret-key')
  })

  test('rows of the retired provisioner model are neither listed nor resolved', async () => {
    const now = new Date()

    docs.push({
      _id: 'legacy',
      teamId: 'team-1',
      url: 'ws://openab-team-1.openab-runtimes.svc:8080/acp',
      status: 'active',
      managedBy: 'provisioner',
      authKeyEnvelope: encryptDatabaseCredentialWithKey('legacy-key', MASTER_KEY),
      createdByUserId: 'provisioner',
      createdAt: now,
      updatedAt: now,
    })

    expect(await listTeamRuntimes('team-1')).toEqual([])
    expect(await resolveTeamRuntimeEndpoints('team-1', kube)).toEqual([])
  })

  test('a runtime Nuphos hosts resolves exactly like a self-hosted one', async () => {
    const url = 'ws://openab-claude-abc.openab-runtimes.svc:8080/acp'
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url,
      authKey: 'hosted-password',
      hostedBy: 'nuphos',
    })

    expect(runtime.hostedBy).toBe('nuphos')
    expect(runtime.connection).toBeUndefined()
    expect(await resolveTeamRuntimeEndpoints('team-1')).toEqual([
      { url, authKey: 'hosted-password', runtimeId: runtime.id },
    ])
    expect(
      (await resolveTeamRuntimeEndpoints('team-1', undefined, 'claude-code', 'control'))[0]
        ?.authKey,
    ).toBe(deriveRuntimeControlKey('hosted-password'))
  })

  test('a runtime another environment hosts does not resolve here', async () => {
    await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'ws://openab-claude-abc.openab-runtimes-dev.svc:8080/acp',
      authKey: 'hosted-password',
      hostedBy: 'nuphos',
    })

    expect(await resolveTeamRuntimeEndpoints('team-1')).toEqual([])
  })

  test('a runtime being deleted stops resolving', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'key-a',
    })

    store.rows('agent_runtime_deletions').push({ _id: runtime.id, teamId: 'team-1' })

    expect(await resolveTeamRuntimeEndpoints('team-1')).toEqual([])
  })

  test('rejects cleartext ws:// outside the cluster and malformed keys', async () => {
    await expect(
      registerTeamRuntime({
        teamId: 'team-1',
        userId: 'user-1',
        url: 'ws://openab.example/acp',
        authKey: 'key-a',
        kube,
      }),
    ).rejects.toThrow('wss://')
    await expect(
      registerTeamRuntime({
        teamId: 'team-1',
        userId: 'user-1',
        url: 'wss://openab.example/acp',
        authKey: 'bad key with spaces',
        kube,
      }),
    ).rejects.toThrow('The admin password can only contain')
  })

  test('removal revokes the key even when the leftover Secret cannot be deleted', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'key-a',
      kube,
    })
    const unavailableKube: KubeClient = {
      ...kube,
      delete: () => Promise.reject(new Error('forbidden')),
    }

    expect(await removeTeamRuntime('team-1', runtime.id, unavailableKube)).toBe(true)
    expect(await listTeamRuntimes('team-1')).toEqual([])
  })

  test('remove is scoped to the owning team', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'key-a',
      kube,
    })

    expect(await removeTeamRuntime('team-2', runtime.id, kube)).toBe(false)
    expect(await removeTeamRuntime('team-1', runtime.id, kube)).toBe(true)
    expect(await listTeamRuntimes('team-1')).toEqual([])
  })
})

test('resolves Codex and legacy Claude runtimes independently within the same workspace', async () => {
  const teamId = 'team-codex'

  await registerTeamRuntime({
    teamId,
    userId: 'admin',
    url: 'wss://claude.example/acp',
    authKey: 'claude-key',
    kube,
  })
  await registerTeamRuntime({
    teamId,
    userId: 'admin',
    url: 'wss://codex.example/acp',
    authKey: 'codex-key',
    provider: 'codex',
    kube,
  })
  delete docs[0]!.provider
  expect((await resolveTeamRuntimeEndpoints(teamId, kube)).map((endpoint) => endpoint.url)).toEqual(
    ['wss://claude.example/acp'],
  )
  expect(await resolveTeamRuntimeEndpoints(teamId, kube, 'codex')).toEqual([
    {
      url: 'wss://codex.example/acp',
      authKey: 'codex-key',
      provider: 'codex',
      runtimeId: docs[1]?._id,
      external: true,
    },
  ])
  expect((await listTeamRuntimes(teamId, 'codex')).map((runtime) => runtime.url)).toEqual([
    'wss://codex.example/acp',
  ])
})

test('chat and control endpoints use separate credentials from the same Secret', async () => {
  const runtime = await registerTeamRuntime({
    teamId: 'team-1',
    userId: 'user-1',
    url: 'wss://openab.example/acp',
    authKey: 'transport-key',
    kube,
  })

  seedRuntimeSecret('team-1', runtime.id, { OPENAB_ACP_CONTROL_KEY: 'independent-control-key' })

  const secret = await kube.getSecret(
    config.claudeCodeRuntimeProvisioner.namespace,
    runtimeAuthSecretName('team-1', runtime.id),
  )

  expect(await readRuntimeAuthSecret('team-1', runtime.id, kube)).toBeNull()
  expect(await readRuntimeControlSecret('team-1', runtime.id, kube)).toBe('independent-control-key')
  expect((await resolveTeamRuntimeEndpoints('team-1', kube))[0]?.authKey).toBe('transport-key')
  expect(
    (await resolveTeamRuntimeEndpoints('team-1', kube, 'claude-code', 'control'))[0]?.authKey,
  ).toBe('independent-control-key')
  delete secret!.OPENAB_ACP_CONTROL_KEY
  expect(await readRuntimeControlSecret('team-1', runtime.id, kube)).toBeNull()
  // With no key anywhere, an external runtime is one connected with only its password,
  // so it gets the key its image derives. The Secret above still won while it held one:
  // an older runtime keeps the key its container was actually started with.
  expect(
    (await resolveTeamRuntimeEndpoints('team-1', kube, 'claude-code', 'control'))[0]?.authKey,
  ).toBe(deriveRuntimeControlKey('transport-key'))
})

test('the derived operator key matches the runtime image, vector for vector', () => {
  // Pinned in zeabur/nuphos-runtime's test/runtime-start.test.mjs too. If these drift,
  // every self-hosted runtime loses status and Codex sign-in at once.
  expect(deriveRuntimeControlKey('correct-horse-battery-staple-0123456789')).toBe(
    '78e1724e5d59fee7238251e59f3571e4cb5587f14f649e324efae6f25b85ad8e',
  )
  expect(
    deriveRuntimeControlKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  ).toBe('c4838404cd7d81464a7ee6e518c24d3c1a5fc4a22525944d79956be27bb990f2')
})

describe('externally registered operator credential', () => {
  const register = (overrides: { authKey?: string; controlKey?: string } = {}) =>
    registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
      controlKey: 'operator-key',
      ...overrides,
    })

  test('resolves the control endpoint from Mongo with no Kubernetes at all', async () => {
    await register()

    expect((await resolveTeamRuntimeEndpoints('team-1'))[0]?.authKey).toBe('transport-key')
    expect(
      (await resolveTeamRuntimeEndpoints('team-1', undefined, 'claude-code', 'control'))[0]
        ?.authKey,
    ).toBe('operator-key')
  })

  test('the stored operator credential is encrypted, not the plaintext', async () => {
    const runtime = await register()
    const doc = docs.find((item) => item._id === runtime.id)

    expect(doc?.controlKeyEnvelope).toBeDefined()
    expect(JSON.stringify(doc?.controlKeyEnvelope)).not.toContain('operator-key')
    expect(decryptDatabaseCredentialWithKey(doc!.controlKeyEnvelope!, MASTER_KEY)).toBe(
      'operator-key',
    )
  })

  test('a runtime connected with only its password gets the operator key its image derives', async () => {
    // The app binds a self-hosted runtime with its address and one password. The
    // image derives the operator key from that password, so this side must too, or
    // status and Codex sign-in stay dark for every runtime connected through the app.
    await register({ controlKey: undefined })

    expect(
      (await resolveTeamRuntimeEndpoints('team-1', undefined, 'claude-code', 'control'))[0]
        ?.authKey,
    ).toBe(deriveRuntimeControlKey('transport-key'))
  })

  test('the same password pasted as both keys is the one-password case, not an error', async () => {
    // openab discards an operator key equal to the transport key, so storing it would
    // leave the channel dark with no error. Store nothing and let the derived key stand.
    const runtime = await register({ controlKey: 'transport-key' })

    expect(docs.find((item) => item._id === runtime.id)?.controlKeyEnvelope).toBeUndefined()
    expect(
      (await resolveTeamRuntimeEndpoints('team-1', undefined, 'claude-code', 'control'))[0]
        ?.authKey,
    ).toBe(deriveRuntimeControlKey('transport-key'))
  })

  test('refuses an operator credential outside the subprotocol charset, and says why', async () => {
    await expect(register({ controlKey: 'operator key/with=padding' })).rejects.toThrow(
      "The operator key can only contain letters, digits and ! # $ % & ' * + - . ^ _ ` | ~.",
    )
  })

  test('refuses a password outside the subprotocol charset, and says why', async () => {
    await expect(register({ authKey: 'has a space and a /slash' })).rejects.toThrow(
      'The admin password can only contain',
    )
  })

  test('rotation replaces both credentials and keeps the runtime id', async () => {
    const runtime = await register()

    expect(
      await rotateRuntimeKeys('team-1', runtime.id, {
        authKey: 'next-transport-key',
        controlKey: 'next-operator-key',
      }),
    ).toBe(true)
    expect(docs.find((item) => item._id === runtime.id)?._id).toBe(runtime.id)
    expect((await resolveTeamRuntimeEndpoints('team-1'))[0]?.authKey).toBe('next-transport-key')
    expect(
      (await resolveTeamRuntimeEndpoints('team-1', undefined, 'claude-code', 'control'))[0]
        ?.authKey,
    ).toBe('next-operator-key')
  })

  test('rotating to just a password drops the stored operator key for the derived one', async () => {
    const runtime = await register()

    await rotateRuntimeKeys('team-1', runtime.id, { authKey: 'next-transport-key' })

    expect(docs.find((item) => item._id === runtime.id)?.controlKeyEnvelope).toBeUndefined()
    // Derived from the new password, not the old one: the image re-derives on restart.
    expect(
      (await resolveTeamRuntimeEndpoints('team-1', undefined, 'claude-code', 'control'))[0]
        ?.authKey,
    ).toBe(deriveRuntimeControlKey('next-transport-key'))
  })

  test('rotation refuses a runtime Nuphos hosts', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'ws://openab-claude-abc.openab-runtimes.svc:8080/acp',
      hostedBy: 'nuphos',
      authKey: 'transport-key',
    })

    expect(await rotateRuntimeKeys('team-1', runtime.id, { authKey: 'next-transport-key' })).toBe(
      false,
    )
  })
})

describe('a self-hosted runtime owns its login', () => {
  test('Nuphos claims nothing about the account of a runtime', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
    })

    expect(runtime).not.toHaveProperty('requiresLogin')
    expect((await listTeamRuntimes('team-1'))[0]).not.toHaveProperty('requiresLogin')
    expect((await resolveTeamRuntimeEndpoints('team-1'))[0]?.url).toBe('wss://openab.example/acp')
  })

  test('a token stored by an earlier release is never handed to the runtime', async () => {
    const runtime = await registerTeamRuntime({
      teamId: 'team-1',
      userId: 'user-1',
      url: 'wss://openab.example/acp',
      authKey: 'transport-key',
    })
    const legacy = docs.find((item) => item._id === runtime.id)!
    const token = `sk-ant-${'a'.repeat(40)}`

    Object.assign(legacy, {
      credentialEnvelope: encryptDatabaseCredentialWithKey(token, MASTER_KEY),
    })
    const [endpoint] = await resolveTeamRuntimeEndpoints('team-1')

    expect(JSON.stringify(endpoint)).not.toContain(token)
    expect((await listTeamRuntimes('team-1'))[0]).not.toHaveProperty('requiresLogin')
  })
})
