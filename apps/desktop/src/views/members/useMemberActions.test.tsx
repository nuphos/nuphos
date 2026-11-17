import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'

mock.module('../../api', () => ({ api: {} }))
mock.module('../../components/ui/toast', () => ({ toast: {} }))

const { useMemberActions: memberActions } = await import('./useMemberActions')

const noop = () => {}
const actions = () =>
  memberActions({
    teamId: 'team',
    currentUserId: 'me',
    inviteEmail: '',
    inviteSubmitting: false,
    setInviteOpen: noop,
    setInviteEmail: noop,
    setInviteSubmitting: noop,
    setMembers: noop,
    setInvitations: noop,
    actingRowKey: null,
    setActingRowKey: noop,
  })

test('cancelling a pending invite confirms with "Withdraw invite"', () => {
  const menu = actions().buildRowMenu({
    kind: 'invitation',
    invitation: { id: 'inv-1', inviteeEmail: 'leo@acme.dev' },
  } as never)

  // Not "Cancel invite" beside the dialog's own Cancel.
  assert.equal(menu.find((item) => item.key === 'cancel-invite')?.confirmLabel, 'Withdraw invite')
})

test('removing a member says what else goes with them', () => {
  const menu = actions().buildRowMenu({
    kind: 'member',
    member: { id: 'leo', name: 'Leo', email: 'leo@acme.dev', role: 'EDITOR' },
  } as never)
  const remove = menu.find((item) => item.key === 'remove-member')!

  assert.match(remove.confirm ?? '', /Computers they share here stop being shared/)
  assert.match(remove.confirm ?? '', /go to the team owner/)
})
