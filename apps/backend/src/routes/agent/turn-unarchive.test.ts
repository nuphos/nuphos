import { describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { restoreArchivedForTurn, restoreArchivedSession, turnActor } from './turn-unarchive'

import type * as dbActual from '@/lib/db'

let restores = 0
let updateOne: () => Promise<{ modifiedCount: number }> = () => {
  restores++

  return Promise.resolve({ modifiedCount: 1 })
}

useDb({
  db: () => ({
    collection: () => ({ updateOne: () => updateOne(), findOne: () => Promise.resolve(null) }),
  }),
})

const archived = { sessionId: 's1', archivedAt: new Date('2026-09-01T00:00:00Z') }
const active = { sessionId: 's2' }

describe('restoreArchivedForTurn', () => {
  test('any turn brings an archived conversation back, a resource or Trigger event too', async () => {
    restores = 0
    await restoreArchivedForTurn(archived, { userId: 'u', messages: [] })
    await restoreArchivedForTurn(archived, { userId: 'u', origin: 'trigger', messages: [] })
    expect(restores).toBe(2)
  })

  test('unarchived and brand-new conversations need no restore', async () => {
    restores = 0
    await restoreArchivedForTurn(active, { userId: 'u', messages: [] })
    await restoreArchivedForTurn(null, { userId: 'u', messages: [] })
    expect(restores).toBe(0)
  })
})

describe('restoreArchivedSession', () => {
  test('a failed restore never fails the admitted turn', async () => {
    updateOne = () => Promise.reject(new Error('mongo down'))

    expect(await restoreArchivedSession('s1', { source: 'turn', userId: 'u' })).toBeUndefined()
  })
})

const turn = (metadata?: object, origin?: 'trigger') => ({
  userId: 'u',
  ...(origin ? { origin } : {}),
  messages: metadata ? [{ metadata }] : [],
})

describe('turnActor', () => {
  test("names the turn's actor, and the agent or token that sent it", () => {
    expect(turnActor(turn())).toEqual({ source: 'turn', userId: 'u' })
    expect(turnActor(turn(undefined, 'trigger'))).toEqual({ source: 'trigger', userId: 'u' })
    expect(turnActor(turn({ source: 'agent.thread', sourceSessionId: 'agent-a' }))).toEqual({
      source: 'turn',
      userId: 'u',
      agentSessionId: 'agent-a',
    })
    expect(turnActor(turn({ source: 'nuphos', cliTokenId: 'tok' }))).toEqual({
      source: 'turn',
      userId: 'u',
      agentTokenId: 'tok',
    })
    // An event's sender is its provider, never an agent session.
    expect(turnActor(turn({ source: 'agent.resource', sourceSessionId: 'x' }))).toEqual({
      source: 'turn',
      userId: 'u',
    })
  })
})
