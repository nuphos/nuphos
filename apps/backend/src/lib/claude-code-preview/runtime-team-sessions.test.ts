import { describe, expect, it } from 'bun:test'

import { teamRuntimeSessions } from './runtime-team-sessions'

const ownedBy =
  (owner: Record<string, string>) =>
  (teamId: string, ids: string[]): Promise<Set<string>> =>
    Promise.resolve(new Set(ids.filter((id) => owner[id] === teamId)))

const unreachableLookup = () => Promise.reject(new Error('should not be called'))
const owner = { sess_a: 'team-a', sess_b: 'team-b' }
const inventory = [
  { sessionId: 'sess_a', state: 'active' },
  { sessionId: 'sess_b', state: 'active' },
  { sessionId: 'sess_orphan', state: 'idle' },
]

describe('teamRuntimeSessions', () => {
  it('keeps only the sessions of the requesting team on a shared runtime', async () => {
    expect(await teamRuntimeSessions('team-a', inventory, ownedBy(owner))).toEqual([
      { sessionId: 'sess_a', state: 'active' },
    ])
    expect(await teamRuntimeSessions('team-b', inventory, ownedBy(owner))).toEqual([
      { sessionId: 'sess_b', state: 'active' },
    ])
  })

  it('reports an empty inventory without a lookup', async () => {
    expect(await teamRuntimeSessions('team-a', [], unreachableLookup)).toEqual([])
  })

  it('cannot attribute an inventory whose sessions carry no id', async () => {
    expect(
      await teamRuntimeSessions('team-a', [...inventory, { state: 'active' }], ownedBy(owner)),
    ).toBeNull()
  })

  it('cannot attribute an inventory holding a malformed entry', async () => {
    expect(
      await teamRuntimeSessions('team-a', [...inventory, null, 'sess_a'], ownedBy(owner)),
    ).toBeNull()
  })
})
