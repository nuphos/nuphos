import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type Doc = Record<string, unknown>

let store: Record<string, Doc[]>

// Just enough of MongoDB for the queries the merge issues: equality on a
// field or a dotted array path, $all, $or, and $pull / positional $set / $set.
const at = (doc: Doc, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], doc)
const matches = (doc: Doc, filter: Doc): boolean =>
  Object.entries(filter).every(([key, want]) => {
    if (key === '$or') return (want as Doc[]).some((f) => matches(doc, f))
    const value = at(doc, key)

    if (want && typeof want === 'object' && '$regex' in want)
      return typeof value === 'string' && new RegExp(want.$regex as string, 'u').test(value)
    if (want && typeof want === 'object' && '$all' in want)
      return (want.$all as unknown[]).every((v) => Array.isArray(value) && value.includes(v))

    return Array.isArray(value) ? value.includes(want) : value === want
  })
const parentOf = (doc: Doc, path: string) => {
  const keys = path.split('.')

  return { parent: at(doc, keys.slice(0, -1).join('.')) as Doc, key: keys.at(-1)! }
}

useDb({
  db: () => ({
    collection: (name: string) => {
      const docs = () => {
        store[name] ??= []

        return store[name]
      }

      return {
        findOne: (filter: Doc) => Promise.resolve(docs().find((d) => matches(d, filter)) ?? null),
        find: (filter: Doc) => ({
          toArray: () => Promise.resolve(docs().filter((d) => matches(d, filter))),
        }),
        updateOne: (filter: Doc, update: Doc) => {
          const doc = docs().find((d) => matches(d, filter))

          for (const [path, value] of Object.entries((update.$set ?? {}) as Doc)) {
            if (!doc) break
            const { parent, key } = parentOf(doc, path)

            parent[key] = value
          }

          return Promise.resolve({})
        },
        deleteOne: (filter: Doc) => {
          store[name] = docs().filter((d) => !matches(d, filter))

          return Promise.resolve({})
        },
        updateMany: (filter: Doc, update: Doc, options?: { arrayFilters?: Doc[] }) => {
          for (const doc of docs().filter((d) => matches(d, filter))) {
            for (const [path, value] of Object.entries((update.$pull ?? {}) as Doc)) {
              const { parent, key } = parentOf(doc, path)

              parent[key] = (parent[key] as unknown[]).filter((v) => v !== value)
            }
            for (const [path, value] of Object.entries((update.$set ?? {}) as Doc)) {
              if (path.endsWith('.$[old]')) {
                const old = options?.arrayFilters?.[0]?.old
                const { parent, key } = parentOf(doc, path.slice(0, -'.$[old]'.length))

                parent[key] = (parent[key] as unknown[]).map((v) => (v === old ? value : v))
              } else doc[path] = value
            }
          }

          return Promise.resolve({})
        },
      }
    },
  }),
})

const { mergeAgentDevice } = await import('./merge')

beforeEach(() => {
  store = {
    agent_devices: [
      { userId: 'u1', deviceId: 'old' },
      // Another user holds the same id, e.g. one Desktop profile signed in to two accounts.
      { userId: 'u2', deviceId: 'old' },
    ],
    agent_conversations: [
      { sessionId: 'mine', userId: 'u1', credentialAccess: { deviceIds: ['x', 'old'] } },
      { sessionId: 'both', userId: 'u1', credentialAccess: { deviceIds: ['old', 'new'] } },
      {
        _id: 'local',
        sessionId: 'local',
        userId: 'u1',
        runtimeId: 'local_u1_old_codex',
        claudeCodePreview: { runtimeUrl: 'nuphos-device://runtime/u1/old?team=t1&provider=codex' },
      },
      { sessionId: 'theirs', userId: 'u2', credentialAccess: { deviceIds: ['old'] } },
      {
        _id: 'their-local',
        sessionId: 'their-local',
        userId: 'u2',
        runtimeId: 'local_u2_old',
        claudeCodePreview: { runtimeUrl: 'nuphos-device://runtime/u2/old?team=t1' },
      },
    ],
    cost_panels: [{ createdBy: 'u1', credentialAccess: { deviceIds: ['old'] } }],
    agent_triggers: [
      {
        userId: 'u3',
        executionPrincipalUserId: 'u1',
        executionCredentialAccess: { deviceIds: ['old'] },
      },
      { userId: 'u2', executionCredentialAccess: { deviceIds: ['old'] } },
    ],
    agent_device_exec_audit: [
      { ownerUserId: 'u1', deviceId: 'old' },
      { ownerUserId: 'u2', deviceId: 'old' },
    ],
  }
})

const ids = (name: string) =>
  store[name]?.map(
    (d) =>
      (at(d, 'credentialAccess.deviceIds') ??
        at(d, 'executionCredentialAccess.deviceIds')) as string[],
  )

describe('mergeAgentDevice', () => {
  test("moves the caller's selections, local agents and history to the new id", async () => {
    expect(await mergeAgentDevice('u1', 'old', 'new')).toBe(true)

    expect(ids('agent_conversations')?.slice(0, 2)).toEqual([['x', 'new'], ['new']])
    expect(store.agent_conversations?.[2]?.runtimeId).toBe('local_u1_new_codex')
    expect(at(store.agent_conversations![2]!, 'claudeCodePreview.runtimeUrl')).toBe(
      'nuphos-device://runtime/u1/new?team=t1&provider=codex',
    )
    expect(ids('cost_panels')).toEqual([['new']])
    expect(ids('agent_triggers')?.[0]).toEqual(['new'])
    expect(store.agent_device_exec_audit?.[0]).toEqual({ ownerUserId: 'u1', deviceId: 'new' })
    expect(store.agent_devices).toEqual([{ userId: 'u2', deviceId: 'old' }])
  })

  test("never touches another user's documents that name the same id", async () => {
    await mergeAgentDevice('u1', 'old', 'new')

    expect(store.agent_conversations?.[3]).toEqual({
      sessionId: 'theirs',
      userId: 'u2',
      credentialAccess: { deviceIds: ['old'] },
    })
    expect(store.agent_conversations?.[4]?.runtimeId).toBe('local_u2_old')
    expect(at(store.agent_conversations![4]!, 'claudeCodePreview.runtimeUrl')).toBe(
      'nuphos-device://runtime/u2/old?team=t1',
    )
    expect(ids('agent_triggers')?.[1]).toEqual(['old'])
    expect(store.agent_device_exec_audit?.[1]).toEqual({ ownerUserId: 'u2', deviceId: 'old' })
  })

  test("is a no-op for the same id or one that is not the caller's", async () => {
    expect(await mergeAgentDevice('u1', 'new', 'new')).toBe(false)
    expect(await mergeAgentDevice('u4', 'old', 'new')).toBe(false)
    expect(ids('agent_conversations')?.[0]).toEqual(['x', 'old'])
    expect(store.agent_devices).toHaveLength(2)
  })
})
