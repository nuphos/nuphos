import { expect, test } from 'bun:test'

import { approvePermissionGrantProposal } from './permission-grant-approve'

test('retired approval refuses even historical requests without looking up credentials or proposals', async () => {
  const result = await approvePermissionGrantProposal({
    teamIdStr: 'no-database-team',
    proposalId: 'no-database-proposal',
    actorUserId: 'historical-actor',
  })

  expect(result).toMatchObject({ ok: false, reason: 'not_pending' })
  if (!result.ok) expect(result.message).toContain('local_exec')
})
