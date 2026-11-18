import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'

const shown: { kind: string; title: string; description?: string }[] = []
let emailSent = true
const resent: string[] = []
const invitedAs: unknown[] = []
// What the server answers for the invitation: an older one leaves out role and inviteUrl.
let answered: Record<string, unknown> = {}

mock.module('../../api', () => ({
  api: {
    atlasInviteTeamMember: async (_team: string, _email: string, role: unknown) => {
      invitedAs.push(role)

      return { invitation: answered, emailSent }
    },
    atlasResendTeamInvitation: async (_team: string, id: string) => {
      resent.push(id)

      return { invitation: answered, emailSent }
    },
    atlasListTeamInvitations: async () => [],
  },
}))
mock.module('../../components/ui/toast', () => ({
  toast: {
    success: (title: string, description?: string) =>
      shown.push({ kind: 'success', title, description }),
    info: (title: string, description?: string) => shown.push({ kind: 'info', title, description }),
    error: (title: string) => shown.push({ kind: 'error', title }),
    apiError: (title: string) => shown.push({ kind: 'error', title }),
  },
}))

const { useMemberActions: memberActions } = await import('./useMemberActions')

const noop = () => {}
const actions = (
  email = 'leo@acme.dev',
  inviteRole: 'EDITOR' | 'VIEWER' | 'ADMINISTRATOR' = 'EDITOR',
) =>
  memberActions({
    teamId: 'team',
    currentUserId: 'me',
    inviteEmail: email,
    inviteRole,
    inviteSubmitting: false,
    setInviteOpen: noop,
    setInviteEmail: noop,
    setInviteSubmitting: noop,
    setMembers: noop,
    setInvitations: noop,
    actingRowKey: null,
    setActingRowKey: noop,
  })
const submit = () => actions().submitInvite({ preventDefault: noop } as never)
const invitationRow = (inviteUrl?: string) =>
  ({
    kind: 'invitation',
    invitation: { id: 'inv-1', inviteeEmail: 'leo@acme.dev', ...(inviteUrl ? { inviteUrl } : {}) },
  }) as never

test('an invite whose email did not go out says so instead of "sent"', async () => {
  shown.length = 0
  emailSent = false
  await submit()
  assert.deepEqual(
    shown.map((toast) => [toast.kind, toast.title]),
    [['info', 'Invited, but no email went out']],
  )
  emailSent = true
  shown.length = 0
  await submit()
  assert.deepEqual(
    shown.map((toast) => [toast.kind, toast.title]),
    [['success', 'Invitation sent']],
  )
})

test('the no-email note mentions copying the link only when there is one', async () => {
  emailSent = false
  answered = { role: 'EDITOR', inviteUrl: 'https://api.example.com/invite?team=Acme' }
  shown.length = 0
  await submit()
  assert.match(shown[0]?.description ?? '', /copy the invite link/)
  answered = { role: 'EDITOR' }
  shown.length = 0
  await submit()
  assert.equal(shown[0]?.description, 'Ask leo@acme.dev to sign in to Nuphos with this address.')
  emailSent = true
  answered = {}
})

test('an older server that ignores the chosen role says they join as Editor', async () => {
  shown.length = 0
  await actions('leo@acme.dev', 'VIEWER').submitInvite({ preventDefault: noop } as never)
  assert.deepEqual(
    shown.map((toast) => toast.title),
    ['Invitation sent', 'leo@acme.dev will join as Editor'],
  )
  // Editor was asked for, or the server kept the role: nothing to warn about.
  shown.length = 0
  await actions('leo@acme.dev', 'EDITOR').submitInvite({ preventDefault: noop } as never)
  answered = { role: 'VIEWER' }
  await actions('leo@acme.dev', 'VIEWER').submitInvite({ preventDefault: noop } as never)
  answered = {}
  assert.deepEqual(
    shown.map((toast) => toast.title),
    ['Invitation sent', 'Invitation sent'],
  )
})

test('a pending invitation can be resent, its link copied, or cancelled', async () => {
  const menu = actions().buildRowMenu(invitationRow('https://api.example.com/invite?team=Acme'))

  assert.deepEqual(
    menu.filter((item) => !item.separator).map((item) => item.label),
    ['Resend email', 'Copy invite link', 'Cancel invite'],
  )
  shown.length = 0
  await menu.find((item) => item.key === 'resend-invite')!.onSelect!()
  assert.deepEqual(resent, ['inv-1'])
  assert.equal(shown[0]?.title, 'Invitation email sent again')
  // An older backend sends no link: no Copy to offer.
  assert.ok(
    !actions()
      .buildRowMenu(invitationRow())
      .some((item) => item.key === 'copy-invite'),
  )
})

test('the invite sends the role the inviter picked', async () => {
  invitedAs.length = 0
  await actions('leo@acme.dev', 'VIEWER').submitInvite({ preventDefault: noop } as never)
  assert.deepEqual(invitedAs, ['VIEWER'])
})

test('the Invite window offers Editor, Viewer and Admin, each explained', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { InviteMemberModal } = await import('./InviteMemberModal')
  const { roleDetail } = await import('./memberRows')

  mock.module('../../components/Modal', () => ({
    Modal: ({ children }: { children: unknown }) => children,
  }))
  const html = renderToStaticMarkup(
    createElement(InviteMemberModal, {
      open: true,
      submitting: false,
      email: '',
      onEmailChange: noop,
      role: 'VIEWER',
      onRoleChange: noop,
      onClose: noop,
      onSubmit: noop,
    }),
  )

  for (const label of ['Editor', 'Viewer', 'Admin']) assert.match(html, new RegExp(`>${label}<`))
  assert.ok(html.includes(roleDetail('VIEWER')))
  assert.match(html, /checked="" value="VIEWER"/)
})

test('a pending invite shows its role in the Role column, and "Invited" under the email', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { buildMemberColumns } = await import('./memberColumns')
  const row = {
    kind: 'invitation',
    invitation: { id: 'inv-1', inviteeEmail: 'leo@acme.dev', role: 'VIEWER' },
  } as never
  const cell = (key: string) =>
    renderToStaticMarkup(buildMemberColumns().find((column) => column.key === key)!.render!(row))

  // The pill stays as short as a member's, so it fits the Role column in every language.
  assert.match(cell('role'), />Viewer</)
  assert.doesNotMatch(cell('role'), /Invited/)
  assert.match(cell('name'), />Invited</)
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
