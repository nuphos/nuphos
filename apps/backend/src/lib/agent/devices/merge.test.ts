import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

type Call = { collection: string; op: string; args: unknown[] }

let calls: Call[]
let registered: Set<string>

useDb({
  db: () => ({
    collection: (name: string) => ({
      findOne: (filter: { userId: string; deviceId: string }) => {
        calls.push({ collection: name, op: 'findOne', args: [filter] })

        return Promise.resolve(
          registered.has(`${filter.userId}:${filter.deviceId}`) ? { ...filter } : null,
        )
      },
      updateMany: (...args: unknown[]) => {
        calls.push({ collection: name, op: 'updateMany', args })

        return Promise.resolve({ modifiedCount: 0 })
      },
      deleteOne: (filter: unknown) => {
        calls.push({ collection: name, op: 'deleteOne', args: [filter] })

        return Promise.resolve({ deletedCount: 1 })
      },
    }),
  }),
})

const { mergeAgentDevice } = await import('./merge')

beforeEach(() => {
  calls = []
  registered = new Set(['u1:old-id'])
})

describe('mergeAgentDevice', () => {
  test('moves every selection from the old id to the new one, then drops the old record', async () => {
    expect(await mergeAgentDevice('u1', 'old-id', 'new-id')).toBe(true)

    const updated = calls.filter((c) => c.op === 'updateMany').map((c) => c.collection)

    expect([...new Set(updated)]).toEqual([
      'agent_conversations',
      'cost_panels',
      'agent_triggers',
      'agent_trigger_groups',
    ])
    expect(
      calls.find((c) => c.collection === 'agent_conversations' && c.op === 'updateMany'),
    ).toMatchObject({
      args: [
        { 'credentialAccess.deviceIds': { $all: ['old-id', 'new-id'] } },
        { $pull: { 'credentialAccess.deviceIds': 'old-id' } },
      ],
    })
    expect(
      calls.filter((c) => c.collection === 'agent_triggers' && c.op === 'updateMany')[1],
    ).toMatchObject({
      args: [
        { 'executionCredentialAccess.deviceIds': 'old-id' },
        { $set: { 'executionCredentialAccess.deviceIds.$[old]': 'new-id' } },
        { arrayFilters: [{ old: 'old-id' }] },
      ],
    })
    expect(calls.at(-1)).toEqual({
      collection: 'agent_devices',
      op: 'deleteOne',
      args: [{ userId: 'u1', deviceId: 'old-id' }],
    })
  })

  test("ignores an id that is not the caller's own registration, and the same id", async () => {
    expect(await mergeAgentDevice('u2', 'old-id', 'new-id')).toBe(false)
    expect(await mergeAgentDevice('u1', 'new-id', 'new-id')).toBe(false)
    expect(calls.filter((c) => c.op !== 'findOne')).toEqual([])
  })
})
