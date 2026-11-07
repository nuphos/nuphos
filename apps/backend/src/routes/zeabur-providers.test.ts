import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { errorHandler } from '@/lib/errors'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useByosAccount } from '@/lib/test/doubles/byos-account'
import { useByosSecrets } from '@/lib/test/doubles/byos-secrets'
import { useModels } from '@/lib/test/doubles/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { ZeaburProviderBinding } from '@/models'

const teamId = new ObjectId()
const userId = new ObjectId().toHexString()
const shared = { zeaburId: 'shared-team', kind: 'team' as const, name: 'Zeabur Inc.' }
let bindings: ZeaburProviderBinding[] = []
let writes = 0
let decrypted: string[] = []

function binding(identities: ZeaburProviderBinding['identities'], tokenSource: string) {
  return {
    id: new ObjectId(),
    identities,
    encryptedToken: {
      v: 1 as const,
      alg: 'A256GCM' as const,
      keyId: 'test',
      iv: '',
      authTag: '',
      ciphertext: tokenSource,
    },
    createdAt: new Date('2026-10-19T08:00:00Z'),
  }
}
function source(index: number) {
  const item = bindings[index]

  if (!item) throw new Error('Missing fixture binding')

  return item
}
useModels({
  teamByosBindings: () => ({
    findOne: () => ({ _id: teamId, zeaburProviders: bindings }),
    updateOne: () => {
      writes += 1

      return { modifiedCount: 1 }
    },
  }),
  // The member's own Personal Credentials are listed with the options; none here.
  personalCredentials: (() => ({ find: () => ({ toArray: async () => [] }) })) as never,
})
useByosAccount({
  listZeaburProviderBindings: () => bindings,
  syncZeaburProviderBindings: () => bindings,
})
useByosSecrets({
  decryptZeaburToken: (encrypted) => {
    decrypted.push(encrypted.ciphertext)

    return `test-token-${encrypted.ciphertext}`
  },
})
useAgentDeviceStore({ isActiveTeamMember: () => false })

const { zeaburProvidersRoutes, publicView } = await import('@/routes/zeabur-providers')
const { getAgentCredentialOptions } = await import('@/routes/agent/credential-options')
const app = new Hono<{ Variables: TeamAuthVariables }>()

app.onError(errorHandler)
app.use('*', async (c, next) => {
  c.set('teamId', teamId.toHexString())
  c.set('teamRole', 'ADMINISTRATOR')
  await next()
})
app.route('/', zeaburProvidersRoutes)
async function readProviders(response: Response) {
  const body = (await response.json()) as {
    providers: (Omit<ReturnType<typeof publicView>[number], 'createdAt'> & { createdAt: string })[]
  }

  return body.providers
}
beforeEach(() => {
  bindings = [
    binding([{ zeaburId: 'user-a', kind: 'user', name: 'Yuanlin' }, shared], 'first'),
    binding(
      [
        { zeaburId: 'user-b', kind: 'user', name: 'Matthew' },
        shared,
        { zeaburId: 'design-team', kind: 'team', name: 'Design Team' },
      ],
      'second',
    ),
    binding([{ zeaburId: 'user-c', kind: 'user', name: 'Can' }, shared], 'third'),
  ]
  writes = 0
  decrypted = []
})
test('GET and credential inventory expose the same five unique remote identities', async () => {
  const before = JSON.stringify(bindings)
  const response = await app.request('/')

  expect(response.status).toBe(200)
  const providers = await readProviders(response)
  const options = await getAgentCredentialOptions(teamId.toHexString(), userId)

  expect(providers).toHaveLength(5)
  expect(options.zeaburProviders).toEqual(
    providers.map(({ zeaburId, kind, name }) => ({ zeaburId, kind, name })),
  )
  expect(providers.find((row) => row.zeaburId === shared.zeaburId)).toEqual({
    ...shared,
    providerId: source(0).id.toHexString(),
    createdAt: source(0).createdAt.toISOString(),
  })
  expect(JSON.stringify(bindings)).toBe(before)
  expect(writes).toBe(0)
  expect(decrypted).toEqual([])
})
test('deduplicated metadata and credentials choose the same first token source', async () => {
  source(1).createdAt = new Date('2026-10-22T08:00:00Z')
  const response = await app.request('/shared-team/credentials')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ zeaburId: shared.zeaburId, token: 'test-token-first' })
  expect(decrypted).toEqual(['first'])
  expect(writes).toBe(0)
})
test('remaining source becomes usable without discarding its other identities', async () => {
  bindings.shift()
  const providers = await readProviders(await app.request('/'))

  expect(providers).toHaveLength(4)
  expect(providers.find((row) => row.zeaburId === shared.zeaburId)?.providerId).toBe(
    source(0).id.toHexString(),
  )
  expect(await (await app.request('/shared-team/credentials')).json()).toEqual({
    zeaburId: shared.zeaburId,
    token: 'test-token-second',
  })
  expect(writes).toBe(0)
})
test('same-named remote teams remain distinct in both API surfaces', async () => {
  source(1).identities.push({ ...shared, zeaburId: 'different-team' })
  const providers = await readProviders(await app.request('/'))

  expect(providers).toHaveLength(6)
  expect(
    (await getAgentCredentialOptions(teamId.toHexString(), userId)).zeaburProviders,
  ).toHaveLength(6)
})
test('single-binding POST projection is compatible and unknown credentials remain 404', async () => {
  expect(publicView(source(0))).toHaveLength(2)
  expect((await app.request('/missing/credentials')).status).toBe(404)
  expect(decrypted).toEqual([])
  expect(writes).toBe(0)
})
