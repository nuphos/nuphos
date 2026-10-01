import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isTeamId } from './teamId.ts'

test('isTeamId accepts ObjectId-shaped ids in either case', () => {
  for (const id of ['69e989027ab63e8d6a0ffcb6', '69E989027AB63E8D6A0FFCB6']) {
    assert.equal(isTeamId(id), true, `expected a team id: ${id}`)
  }
})

// The shape this guard exists for: the Chats page hands the row's title hint to
// a handler whose second argument is the owning team id. A conversation title
// reaching createWorkspaceTab produced a "?" workspace whose every request
// failed with "Invalid teamId", and whose chat list — the backend drops an
// unverifiable teamId — spanned every team the viewer belongs to.
test('isTeamId rejects conversation titles and other non-ids', () => {
  for (const value of [
    'Why is the staging deploy stuck?',
    '幫我看一下 production 的 CPU',
    '',
    '   ',
    'undefined',
    'team-1',
    '69e989027ab63e8d6a0ffcb', // 23 chars
    '69e989027ab63e8d6a0ffcb6a', // 25 chars
    '69e989027ab63e8d6a0ffcbg', // non-hex
    undefined,
    null,
    123,
  ]) {
    assert.equal(isTeamId(value), false, `expected NOT a team id: ${String(value)}`)
  }
})
