// The enrolment write, isolated from Mongo. The team bindings document is
// created lazily by whichever connector a team binds first, so "this team has
// never bound anything" is a real first-run path — and getting it wrong looked
// like a duplicate-label conflict rather than a missing document.
import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { MongoServerError } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useRelayToken } from '@/lib/test/doubles/byos-relay-token'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'

type UpdateCall = {
  filter: Record<string, unknown>
  update: Record<string, unknown>
  options?: Record<string, unknown>
}

let updateCalls: UpdateCall[] = []
let updateError: Error | null = null
/** How many leading updateOne calls throw `updateError` (the rest succeed). */
let updateErrorTimes = Number.POSITIVE_INFINITY
let storedDoc: Record<string, unknown> | null = null

useModels({
  teamByosBindings: () => ({
    findOne: async (filter: Record<string, unknown>) => {
      const duplicateLabel = filter['onpremClusters.label'] as { $ne?: string } | undefined
      const storedClusters = (storedDoc?.onpremClusters as { label?: string }[] | undefined) ?? []

      if (duplicateLabel?.$ne && storedClusters.some((row) => row.label === duplicateLabel.$ne)) {
        return null
      }

      return storedDoc
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      updateCalls.push({ filter, update, options })
      if (updateError && updateCalls.length <= updateErrorTimes) throw updateError

      const duplicateLabel = filter['onpremClusters.label'] as { $ne?: string } | undefined
      const storedClusters = (storedDoc?.onpremClusters as { label?: string }[] | undefined) ?? []
      const duplicate =
        duplicateLabel?.$ne !== undefined &&
        storedClusters.some((row) => row.label === duplicateLabel.$ne)

      if (duplicate) return { matchedCount: 0, modifiedCount: 0, upsertedId: null }

      return { matchedCount: 1, modifiedCount: 1, upsertedId: null }
    },
  }),
})

// The bind route asks the entitlement layer for headroom first, and the final
// append re-checks it under the write lock. These suites are about the write,
// not billing, so hand them a grandfathered workspace — the one population
// that resolves to "no limit" regardless of whether Stripe is configured, so

// The route's own authorisation is not what these tests are about; team scoping
// is exercised where the middleware lives.
useAuthMiddleware({
  requireTeamRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next()
  },
})

useByosSecrets({
  encryptOnpremKubeconfig: () => ({
    v: 1,
    alg: 'A256GCM',
    keyId: 'test',
    iv: 'iv',
    authTag: 'tag',
    ciphertext: 'cipher',
  }),
  decryptOnpremKubeconfig: () => KUBECONFIG,
})

useRelayToken({
  relayConfigured: () => true,
  mintRelayAgentToken: () => 'nr1_agent-token',
  relayProxyUrl: (_clusterKey, sessionId) =>
    `https://relay.example.test/tunnel?session=${encodeURIComponent(sessionId)}`,
})

const { onpremClustersRoutes } = await import('@/routes/onprem-clusters')

const TEAM = '69e989027ab63e8d6a0ffcb6'
const USER = '62e6289482f5f9d9408f1a79'

const KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
  - name: onprem
    cluster:
      server: https://10.0.0.1:6443
      certificate-authority-data: Q0EtREFUQQ==
users:
  - name: nuphos
    user:
      token: sa-token
`

function app() {
  const outer = new Hono<{ Variables: TeamAuthVariables }>()

  // The same mapping the real app installs, so AppError statuses are asserted
  // as callers see them rather than as raw 500s.
  outer.onError(errorHandler)
  outer.use('*', async (c, next) => {
    c.set('teamId', TEAM)
    c.set('userId', USER)
    await next()
  })
  outer.route('/', onpremClustersRoutes)

  return outer
}

function put(path: string, body: Record<string, unknown>) {
  return app().request(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function enrol(body: Record<string, unknown>) {
  return app().request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  updateCalls = []
  updateError = null
  updateErrorTimes = Number.POSITIVE_INFINITY
  storedDoc = null
})

const CLUSTER_ID = '507f1f77bcf86cd799439011'

/** A stored binding, as loadBinding would find it. */
function storedCluster(overrides: Record<string, unknown> = {}) {
  return {
    onpremClusters: [
      {
        id: { toHexString: () => CLUSTER_ID },
        label: 'acme-dc1',
        clusterKey: 'cluster-key',
        createdAt: new Date(),
        tokenIssuedAt: new Date(),
        ...overrides,
      },
    ],
  }
}

describe('PUT /onprem-clusters/:id/kubeconfig', () => {
  test('stores the credential and reports the cluster as having one', async () => {
    storedDoc = storedCluster()
    const response = await put(`/${CLUSTER_ID}/kubeconfig`, { kubeconfig: KUBECONFIG })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      cluster: { hasCredential: boolean; endpoint: string }
    }

    expect(body.cluster.hasCredential).toBe(true)
    expect(body.cluster.endpoint).toBe('https://10.0.0.1:6443')

    const set = (updateCalls[0]!.update as { $set: Record<string, unknown> }).$set

    expect(set['onpremClusters.$.endpoint']).toBe('https://10.0.0.1:6443')
    expect(set['onpremClusters.$.encryptedKubeconfig']).toBeDefined()
  })

  test('refuses a kubeconfig the sandbox could not use, and writes nothing', async () => {
    storedDoc = storedCluster()
    const response = await put(`/${CLUSTER_ID}/kubeconfig`, {
      kubeconfig: KUBECONFIG.replace(
        '      token: sa-token',
        '      exec:\n        command: kubelogin',
      ),
    })

    expect(response.status).toBe(400)
    expect(updateCalls).toHaveLength(0)
  })

  test('404s for a cluster this team does not have', async () => {
    storedDoc = { onpremClusters: [] }
    const response = await put(`/${CLUSTER_ID}/kubeconfig`, { kubeconfig: KUBECONFIG })

    expect(response.status).toBe(404)
  })
})

describe('GET /onprem-clusters/:id/access', () => {
  test('will not pretend to check a cluster that has no credential yet', async () => {
    storedDoc = storedCluster()
    const response = await app().request(`/${CLUSTER_ID}/access`)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'onprem_cluster_has_no_credential' },
    })
  })
})

describe('GET /onprem-clusters/:id/kubeconfig', () => {
  test('returns a short-lived relayed kubeconfig for an allowed member', async () => {
    storedDoc = storedCluster({
      encryptedKubeconfig: { ciphertext: 'encrypted' },
      access: { memberAllowList: [USER] },
    })
    const response = await app().request(`/${CLUSTER_ID}/kubeconfig`)
    const yaml = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(yaml).toContain('onprem/acme-dc1/cluster')
    expect(yaml).toContain('relay.example.test/tunnel')
    expect(yaml).toContain('token: sa-token')
  })

  test('rejects a member outside the cluster allow-list', async () => {
    storedDoc = storedCluster({
      encryptedKubeconfig: { ciphertext: 'encrypted' },
      access: { memberAllowList: ['someone-else'] },
    })
    const response = await app().request(`/${CLUSTER_ID}/kubeconfig`)

    expect(response.status).toBe(403)
  })
})

describe('POST /onprem-clusters', () => {
  test('upserts, so a team whose first-ever binding is on-prem is not rejected', async () => {
    const response = await enrol({ label: 'acme-dc1', kubeconfig: KUBECONFIG })

    expect(response.status).toBe(201)

    expect(updateCalls).toHaveLength(2)
    const [ensureCall, call] = updateCalls

    expect(ensureCall!.options).toMatchObject({ upsert: true })
    // The first write creates a complete empty binding document. The second
    // atomically pushes the environment under the entitlement predicate.
    const insertDefaults = (ensureCall!.update as { $setOnInsert: Record<string, unknown> })
      .$setOnInsert

    expect(insertDefaults).toBeDefined()
    expect(insertDefaults).toHaveProperty('onpremClusters')
    expect(insertDefaults).toHaveProperty('awsRoles')
    expect(call!.update).toHaveProperty('$push')
  })

  test('hands back the token and a manifest with no placeholders left', async () => {
    const response = await enrol({ label: 'acme-dc1', kubeconfig: KUBECONFIG })
    const body = (await response.json()) as {
      cluster: { contextName: string; endpoint: string }
      install: { token: string; agentEndpoint: string; manifest: string }
    }

    expect(body.cluster.contextName).toBe('onprem/acme-dc1/cluster')
    expect(body.cluster.endpoint).toBe('https://10.0.0.1:6443')
    expect(body.install.token).toBe('nr1_agent-token')
    expect(body.install.manifest).toContain('nr1_agent-token')
    expect(body.install.manifest).toContain(body.install.agentEndpoint)
    // Substitution of the other placeholders is pinned against the reference
    // manifest in relay-install-manifest.test.ts.
    for (const placeholder of [
      'RELAY_ENDPOINT_PLACEHOLDER',
      'RELAY_TOKEN_PLACEHOLDER',
      'IMAGE_PLACEHOLDER',
    ]) {
      expect(body.install.manifest).not.toContain(placeholder)
    }
  })

  test('maps the duplicate-label collision to a 409, not a 500', async () => {
    storedDoc = storedCluster()
    const response = await enrol({ label: 'acme-dc1', kubeconfig: KUBECONFIG })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'onprem_cluster_label_taken' } })
  })

  test('a lost race to create the document is not reported as a taken label', async () => {
    // Two first-ever enrolments with different labels both try to insert under
    // the same team id, so the loser sees the same E11000 a duplicate label
    // would raise. By the retry the document exists, so its push lands.
    updateError = Object.assign(new MongoServerError({ message: 'duplicate key' }), { code: 11000 })
    updateErrorTimes = 1

    const response = await enrol({ label: 'acme-dc2', kubeconfig: KUBECONFIG })

    expect(response.status).toBe(201)
    expect(updateCalls).toHaveLength(2)
  })

  test('does not swallow an unrelated write failure', async () => {
    updateError = Object.assign(new MongoServerError({ message: 'not primary' }), { code: 10107 })
    const response = await enrol({ label: 'acme-dc1', kubeconfig: KUBECONFIG })

    // Anything that is not the duplicate-label collision stays a server error
    // instead of being reported as a naming conflict.
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'internal_error' } })
    expect(updateCalls).toHaveLength(1)
  })

  test('refuses a kubeconfig the sandbox could not use', async () => {
    const execKubeconfig = KUBECONFIG.replace(
      '      token: sa-token',
      '      exec:\n        command: kubelogin',
    )
    const response = await enrol({ label: 'acme-dc1', kubeconfig: execKubeconfig })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'onprem_kubeconfig_unusable' } })
    expect(updateCalls).toHaveLength(0)
  })

  test('enrols without a credential, because the tunnel is proven first', async () => {
    const response = await enrol({ label: 'acme-dc1' })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      cluster: { hasCredential: boolean; endpoint: string | null }
    }

    // Reachable but invisible to agent sessions until a kubeconfig arrives.
    expect(body.cluster.hasCredential).toBe(false)
    expect(body.cluster.endpoint).toBeNull()

    const pushed = (
      updateCalls[1]!.update as { $push: { onpremClusters: Record<string, unknown> } }
    ).$push.onpremClusters

    expect(pushed).not.toHaveProperty('encryptedKubeconfig')
    expect(pushed).not.toHaveProperty('endpoint')
  })

  test('rejects a label that would not survive as a kubectl context name', async () => {
    const response = await enrol({ label: 'Acme DC1', kubeconfig: KUBECONFIG })

    expect(response.status).toBe(400)
    expect(updateCalls).toHaveLength(0)
  })
})
