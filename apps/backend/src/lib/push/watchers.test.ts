import { describe, expect, test } from 'bun:test'

import { watcherCanRead } from './watchers'

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
