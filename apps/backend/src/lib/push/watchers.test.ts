import { describe, expect, test } from 'bun:test'

import { readingWatchers, watcherCanRead } from './watchers'

const member = async () => ({ role: 'MEMBER' })
const removed = async () => null
const shared = {
  userId: 'owner',
  teamId: 't',
  generalAccess: 'none' as const,
  participantIds: ['b'],
}

describe('watcherCanRead', () => {
  test('the owner and a current participant still in the team may be notified', async () => {
    expect(await watcherCanRead(shared, 'owner', removed)).toBe(true)
    expect(await watcherCanRead(shared, 'b', member)).toBe(true)
  })

  test('a watcher removed from the conversation is not', async () => {
    expect(await watcherCanRead({ ...shared, participantIds: [] }, 'b', member)).toBe(false)
  })

  test('a watcher whose only access was general access is not once it is narrowed', async () => {
    const teamWide = { userId: 'owner', teamId: 't', generalAccess: 'view' as const }

    expect(await watcherCanRead(teamWide, 'c', member)).toBe(true)
    expect(await watcherCanRead({ ...teamWide, generalAccess: 'none' }, 'c', member)).toBe(false)
  })

  test('a watcher removed from the team is not', async () => {
    expect(await watcherCanRead(shared, 'b', removed)).toBe(false)
  })
})

describe('readingWatchers', () => {
  test('a push reaches the watchers who can still read, and none who cannot', async () => {
    const channel = { ...shared, watcherIds: ['owner', 'b', 'gone'] }

    expect(await readingWatchers(channel, member)).toEqual(['owner', 'b'])
    // Out of the team, only the owner is left.
    expect(await readingWatchers(channel, removed)).toEqual(['owner'])
    expect(await readingWatchers(shared, member)).toEqual([])
  })
})
