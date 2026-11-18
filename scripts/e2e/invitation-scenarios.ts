// Scenarios about workspace invitations: the role an invited person joins with, and who may send
// an invitation's email again. The stack sets up no email, so no invitation email goes out here.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { client, joinAsAdmin, must } from './binding-access-scenarios.ts'
import { until } from './processes.ts'

import type { Client, Flow } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Role = 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER'
type Invitation = { id: string; role?: Role; inviteUrl?: string }

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Sets when the invitation's email last went out, as a send that worked does. */
function markSent(mongoUri: string, invitationId: string, minutesAgo: number): void {
  const run = `
    import { MongoClient, ObjectId } from 'mongodb'
    const [uri, id, minutes] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    await client.db('nuphos_e2e').collection('team_invitations').updateOne(
      { _id: new ObjectId(id) },
      { $set: { lastSentAt: new Date(Date.now() - Number(minutes) * 60_000) } },
    )
    await client.close()`

  execFileSync('bun', ['-e', run, mongoUri, invitationId, String(minutesAgo)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

/** Signs a new person in, with no team of this stack's yet. */
async function signIn(stack: Flow, name: string): Promise<{ as: Client; email: string }> {
  const email = `e2e-${name}-${String(Date.now())}@example.com`
  const anonymous = client(stack.apiUrl, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until(`the ${name} sign-in code to be logged`, async () => stack.signInCode(email))
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })

  return { as: client(stack.apiUrl, (verified.body as { token: string }).token), email }
}

async function invite(stack: Flow, by: Client, inviteeEmail: string, role?: Role) {
  const invited = await by('POST', `/teams/${stack.teamId}/invitations`, {
    inviteeEmail,
    ...(role ? { role } : {}),
  })

  must(invited.status === 201, `the invitation to be made, got ${String(invited.status)}`)

  return invited.body as { invitation: Invitation; emailSent: boolean }
}

/** Accepts the invitation, and gives the role the accept answered and the one the team lists. */
async function accept(stack: Flow, owner: Client, invitee: Client, invitationId: string) {
  const accepted = await invitee('POST', `/invitations/${invitationId}/accept`)

  must(accepted.status === 200, `the invitation to be accepted, got ${String(accepted.status)}`)
  const me = (await invitee('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const member = await owner('GET', `/teams/${stack.teamId}/members/${me.user?.id ?? me.id ?? ''}`)

  return {
    answered: (accepted.body as { invitation: Invitation }).invitation.role,
    listed: (member.body as { member?: { role?: Role } }).member?.role,
  }
}

// The owner invites one person as each role, and one without saying: each joins as invited,
// and the one without a role as an Editor, as every invitation did before roles.
export async function invitationRolesFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)

  for (const role of ['EDITOR', 'VIEWER', 'ADMINISTRATOR', undefined] as const) {
    const expected = role ?? 'EDITOR'
    const person = await signIn(stack, (role ?? 'unsaid').toLowerCase())
    const { invitation } = await invite(stack, owner, person.email, role)

    must(invitation.role === expected, `the invitation to carry ${expected}`)
    const joined = await accept(stack, owner, person.as, invitation.id)

    log(
      `invited as ${role ?? '(none)'}: accept says ${String(joined.answered)}, team lists ${String(joined.listed)}`,
    )
    must(joined.answered === expected, `accepting to answer ${expected}`)
    must(joined.listed === expected, `the team to list them as ${expected}`)
  }
}

// An admin invites someone as Admin and is then demoted: the invitation still stands, but the
// person joins as an Editor, since an Admin invitation gives Admin only while its inviter is one.
export async function demotedInviterFlow(stack: Flow, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const { member: inviter, memberId: inviterId } = await joinAsAdmin(stack, owner)
  const person = await signIn(stack, 'late-admin')
  const { invitation } = await invite(stack, inviter, person.email, 'ADMINISTRATOR')

  must(invitation.role === 'ADMINISTRATOR', 'the invitation to carry ADMINISTRATOR')
  const demoted = await owner('PATCH', `/teams/${stack.teamId}/members/${inviterId}`, {
    role: 'EDITOR',
  })

  must(demoted.status === 200, `the inviter to be demoted, got ${String(demoted.status)}`)
  const joined = await accept(stack, owner, person.as, invitation.id)

  log(
    `inviter demoted to Editor: accept says ${String(joined.answered)}, team lists ${String(joined.listed)}`,
  )
  must(joined.answered === 'EDITOR', 'accepting to answer EDITOR')
  must(joined.listed === 'EDITOR', 'the team to list them as EDITOR')
}

// Admins resend a pending invitation's email and copy its link; other members do neither. A
// resend waits 5 minutes after an email that went out, and not at all after one that did not.
export async function invitationResendFlow(stack: Stack, log: (line: string) => void = () => {}) {
  const owner = client(stack.apiUrl, stack.token)
  const editor = await signIn(stack, 'editor')
  const asEditor = await invite(stack, owner, editor.email)

  await accept(stack, owner, editor.as, asEditor.invitation.id)
  const created = await invite(stack, owner, `e2e-pending-${String(Date.now())}@example.com`)
  const id = created.invitation.id
  const resend = (as: Client) => as('POST', `/teams/${stack.teamId}/invitations/${id}/resend`)
  const listed = async (as: Client) =>
    (
      (await as('GET', `/teams/${stack.teamId}/invitations`)).body as { invitations: Invitation[] }
    ).invitations.find((invitation) => invitation.id === id)

  try {
    log(
      `created: emailSent ${String(created.emailSent)}, inviteUrl ${String(created.invitation.inviteUrl)}`,
    )
    must(!created.emailSent, 'no email to go out, since the stack sets up none')
    must(Boolean(created.invitation.inviteUrl), 'the admin to get the invite link')
    must(Boolean((await listed(owner))?.inviteUrl), 'the admin to see the link in the list')
    const seen = await listed(editor.as)

    must(Boolean(seen) && !seen?.inviteUrl, 'an Editor to see the invitation without its link')

    const byEditor = await resend(editor.as)

    log(`Editor resends: ${String(byEditor.status)}`)
    must(byEditor.status === 403, 'an Editor to be refused a resend')

    // Nothing went out, so nothing was "just sent": the admin may try again at once.
    const unsent = await resend(owner)

    log(
      `admin resends after no email went out: ${String(unsent.status)} ${unsent.text.slice(0, 160)}`,
    )
    must(unsent.status === 200, 'the resend not to be held back')

    markSent(stack.mongoUri, id, 1)
    const tooSoon = await resend(owner)

    log(
      `admin resends a minute after an email: ${String(tooSoon.status)} ${tooSoon.text.slice(0, 160)}`,
    )
    must(
      tooSoon.status === 429 && tooSoon.text.includes('resend_too_soon'),
      'a resend within 5 minutes of an email to be refused',
    )

    markSent(stack.mongoUri, id, 6)
    const later = await resend(owner)

    log(`admin resends 6 minutes after an email: ${String(later.status)}`)
    must(later.status === 200, 'a resend after 5 minutes to go ahead')
  } finally {
    await owner('DELETE', `/teams/${stack.teamId}/invitations/${id}`)
  }
}

export const invitationScenarios: Scenario[] = [
  {
    name: 'an invited Editor, Viewer and Admin join with the right role',
    run: async (_page, stack) => invitationRolesFlow(stack),
  },
  {
    name: 'an Admin invitation whose inviter lost admin joins as Editor',
    run: async (_page, stack) => demotedInviterFlow(stack),
  },
  {
    name: 'only an admin resends an invitation, at most every 5 minutes after an email went out',
    run: async (_page, stack) => invitationResendFlow(stack),
    // Refused on purpose: the Editor's resend, and the one inside 5 minutes.
    expected:
      /\/invitations\/[0-9a-f]{24}\/resend","status":(403,"error_code":"forbidden"|429,"error_code":"resend_too_soon")/,
  },
]
