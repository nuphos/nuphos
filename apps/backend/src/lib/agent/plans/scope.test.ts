import { expect, test } from 'bun:test'

import { withTeamScope } from './scope'

test('a team list never falls back to plans without a teamId', () => {
  expect(withTeamScope({ status: 'proposed' }, 'team-a')).toEqual({
    status: 'proposed',
    teamId: 'team-a',
  })
})
