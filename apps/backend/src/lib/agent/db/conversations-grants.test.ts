import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { upsertConversationShell } from './conversations'

let inserted: Record<string, unknown> | undefined

useDb({
  db: () => ({
    collection: () => ({
      updateOne(_filter: unknown, update: { $setOnInsert: Record<string, unknown> }) {
        inserted = update.$setOnInsert

        return Promise.resolve({ upsertedCount: 1 })
      },
    }),
  }),
})

function openThread(parentGrants?: Parameters<typeof upsertConversationShell>[0]['parentGrants']) {
  return upsertConversationShell({
    sessionId: 'child',
    userId: 'owner',
    teamId: 'team',
    title: 'Child',
    firstMessage: 'x',
    source: 'agent.thread',
    parentSessionId: 'parent',
    parentGrants,
  })
}

beforeEach(() => {
  inserted = undefined
})

describe('a new thread inherits its parent read grants', () => {
  test('a parent shared with a teammate and the team shares its thread the same way', async () => {
    await openThread({
      generalAccess: 'reply',
      participantIds: ['x', 'v'],
      managerIds: ['x'],
    } as never)

    // Managing does not carry over, and an old team-wide reply reads as view.
    expect(inserted).toMatchObject({
      generalAccess: 'view',
      participantIds: ['x', 'v'],
    })
    expect(inserted).not.toHaveProperty('managerIds')
    expect(inserted?.watcherIds).toEqual([])
  })

  test('a private parent, or none given, leaves the thread private', async () => {
    await openThread({ generalAccess: 'none' })
    expect(inserted).toMatchObject({ generalAccess: 'none' })
    expect(inserted).not.toHaveProperty('participantIds')

    await openThread()
    expect(inserted).toMatchObject({ generalAccess: 'none' })
  })

  test('a legacy parent without general access reads as team-wide view', async () => {
    await openThread({})
    expect(inserted).toMatchObject({ generalAccess: 'view' })
  })
})
