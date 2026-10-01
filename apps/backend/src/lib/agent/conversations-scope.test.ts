import { describe, expect, test } from 'bun:test'

import { getConversations } from '@/lib/agent/db'
import { isTeamIdShape } from '@/lib/team-id'

// Listing conversations is a per-team question. It used to accept a missing
// teamId and answer with the viewer's chats across every team — the shape that
// let the desktop's Chats page, once its tab lost its team scope, show one
// team's page around another team's data. The widening is gone: no teamId, no
// listing. Throwing here beats any caller-side discipline, so this stays a
// unit test rather than a route test.
describe('getConversations refuses to widen past one team', () => {
  for (const teamId of ['', undefined, null]) {
    test(`rejects teamId=${JSON.stringify(teamId)} instead of listing every team`, async () => {
      await expect(
        getConversations('user-1', { teamId: teamId as unknown as string }),
      ).rejects.toThrow('getConversations requires a teamId')
    })
  }
})

// GET /agent/conversations answers 400 for a malformed id and 403 only for a
// real one the caller can't reach. resolveVerifiedTeamId collapses both cases
// into `undefined`, so the route asks this predicate first — without it,
// `teamId=garbage` came back as "You are not a member of this team".
describe('isTeamIdShape', () => {
  test('accepts 24-hex ids in either case', () => {
    expect(isTeamIdShape('69e989027ab63e8d6a0ffcb6')).toBe(true)
    expect(isTeamIdShape('69E989027AB63E8D6A0FFCB6')).toBe(true)
  })

  test('rejects anything that could never be a team id', () => {
    for (const value of [
      'not-an-id',
      'team-1',
      '69e989027ab63e8d6a0ffcb', // 23 chars
      '69e989027ab63e8d6a0ffcb6a', // 25 chars
      '69e989027ab63e8d6a0ffcbg', // non-hex
      ' 69e989027ab63e8d6a0ffcb6',
      '',
    ]) {
      expect(isTeamIdShape(value)).toBe(false)
    }
  })
})
