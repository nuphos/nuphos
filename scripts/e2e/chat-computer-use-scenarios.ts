// Scenarios about what a chat on someone's computer gives the people invited to it: use of the
// whole computer, which removing them from the chat, or undoing the invite, never takes back.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { until } from './processes.ts'

import type { Client, Flow } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** What the app reports of the computer it runs on. */
type AppComputer = { deviceId?: string; connection?: string }

/** Runs `script` against the database; it reads its arguments from process.argv. */
function inDatabase(mongoUri: string, script: string, ...args: string[]): void {
  const run = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    ${script}
    await client.close()`

  execFileSync('bun', ['-e', run, mongoUri, ...args], { cwd: BACKEND_DIR, timeout: 10_000 })
}

/** A chat owned by `ownerId` that runs on `runtimeId`, as starting one on that computer makes. */
function chatOn(stack: Stack, sessionId: string, ownerId: string, runtimeId: string) {
  inDatabase(
    stack.mongoUri,
    `const now = new Date()
    await db.collection('agent_conversations').insertOne({ sessionId: process.argv[2],
      teamId: process.argv[3], userId: process.argv[4], runtimeId: process.argv[5],
      runtimeLabel: 'Claude Code', title: 'On the shared computer', participantIds: [],
      createdAt: now, updatedAt: now })`,
    sessionId,
    stack.teamId,
    ownerId,
    runtimeId,
  )
}

/** Signs another person in; accepting an invitation, they join as an Editor. */
async function join(stack: Flow, owner: Client, name: string) {
  const email = `e2e-${name}-${String(Date.now())}@example.com`
  const anonymous = client(stack.apiUrl, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until(`the ${name} sign-in code to be logged`, async () => stack.signInCode(email))
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })
  const member = client(stack.apiUrl, (verified.body as { token: string }).token)
  const invited = await owner('POST', `/teams/${stack.teamId}/invitations`, { inviteeEmail: email })
  const invitationId = (invited.body as { invitation: { id: string } }).invitation.id

  must(
    (await member('POST', `/invitations/${invitationId}/accept`)).status === 200,
    `the ${name} to accept the invitation`,
  )

  return { member, id: await userId(member) }
}

async function userId(as: Client): Promise<string> {
  const me = (await as('GET', '/auth/me')).body as { user?: { id: string }; id?: string }

  return me.user?.id ?? me.id ?? ''
}

const code = (reply: { body: unknown }) =>
  (reply.body as { error?: { code?: string } } | null)?.error?.code

// The app's own computer stands in for the owner's: the stack's user owns it and shares it with
// one teammate by name, then invites another to a chat on it, which gives them use of it too.
export async function removalKeepsComputerFlow(
  page: Page,
  stack: Stack,
  log: (line: string) => void = () => {},
) {
  const owner = client(stack.apiUrl, stack.token)
  let deviceId = ''

  // Asked of the app itself: other scenarios connect stand-in computers as the same person.
  await until('the app to be online as its computer', async () => {
    const state = await page.evaluate(() =>
      (window as unknown as { api: { localRuntimeGetState: () => Promise<AppComputer> } }).api
        .localRuntimeGetState()
        .catch(() => null),
    )

    deviceId = state?.connection === 'online' ? (state.deviceId ?? '') : ''

    return deviceId
  })
  log(`the app's computer: ${deviceId}`)
  const ownerId = await userId(owner)
  const invitee = await join(stack, owner, 'invitee')
  const user = await join(stack, owner, 'user')
  const share = `/agent/devices/${deviceId}/share?teamId=${stack.teamId}`
  const shared = await owner('PUT', share, {
    level: 'full',
    everyone: false,
    userIds: [user.id],
    managerIds: [],
  })

  must(shared.status === 200, `the computer to be shared, got ${String(shared.status)}`)
  const runtimeId = `local_${ownerId}_${deviceId}`
  const sessionId = `e2e-keep-use-${randomUUID()}`
  const chat = `/agent/conversations/${sessionId}/participants`
  const scope = `?teamId=${stack.teamId}`
  const access = async (as: Client) => {
    const listed = (await as('GET', `/agent/devices${scope}`)).body as {
      devices: { deviceId: string; label?: string; access?: string }[]
    }

    return listed.devices.find((device) => device.deviceId === deviceId)
  }
  // The newest change to who may use the computer.
  const lastChange = async () => {
    const audit = (await owner('GET', `/agent/devices/${deviceId}/access-audit${scope}`)).body as {
      entries: { id: string | null; via: string }[]
    }

    return audit.entries[0]
  }
  const invite = (grantComputerUse: boolean) =>
    owner('POST', `${chat}${scope}`, { userIds: [invitee.id], grantComputerUse })
  // What the Share card's remove and an invite's Undo both send: the invitee keeps the computer.
  const removeKeeping = async (what: string, label: string) => {
    const removed = await owner('DELETE', `${chat}/${invitee.id}${scope}`)
    const kept = (removed.body as { computerStillShared?: { deviceId: string; label: string } })
      .computerStillShared

    log(`${what}: ${String(removed.status)} ${JSON.stringify(kept)}`)
    must(removed.status === 200, `the ${what} to land, got ${String(removed.status)}`)
    must(
      kept?.deviceId === deviceId && kept.label === label,
      `the ${what} to say they can still use this computer`,
    )
    must((await access(invitee.member))?.access === 'use', `the ${what} to leave them use`)
    must((await access(user.member))?.access === 'use', `the ${what} to leave the teammate use`)
  }

  try {
    chatOn(stack, sessionId, ownerId, runtimeId)
    must((await access(invitee.member)) === undefined, 'the invitee not to use the computer yet')

    // Inviting asks first, naming the computer, then gives the invitee use of it.
    const asked = await invite(false)
    const label = (await access(owner))?.label ?? ''
    const named = (asked.body as { error?: { details?: { computer?: { label?: string } } } }).error
      ?.details?.computer?.label

    log(`invite unconfirmed: ${String(asked.status)} ${asked.text.slice(0, 200)}`)
    must(
      asked.status === 409 && code(asked) === 'computer_use_required' && named === label,
      'the invite to ask before giving use of the computer, naming it',
    )
    const invited = await invite(true)

    must(invited.status === 200, `the confirmed invite to land, got ${String(invited.status)}`)
    must((await access(invitee.member))?.access === 'use', 'the invitee to use the computer')
    const recorded = await lastChange()

    must(recorded?.via === 'conversation_invite', 'the confirmed invite to be on the history')

    // Undo of that invite takes them out of the chat only.
    await removeKeeping('undo', label)
    // Back in, now with no question, and removed from the Share card: the same.
    const again = await invite(false)

    must(again.status === 200, `inviting again to need no grant, got ${String(again.status)}`)
    await removeKeeping('removal', label)
    // Leaving on their own: nothing to tell anyone, and nothing changes either.
    must((await invite(false)).status === 200, 'the third invite to land')
    const left = await invitee.member('DELETE', `${chat}/${invitee.id}${scope}`)

    must(left.status === 200, `leaving to land, got ${String(left.status)}`)
    must(!(left.body as Record<string, unknown>).computerStillShared, 'leaving to carry no notice')
    must((await access(invitee.member))?.access === 'use', 'leaving to leave them use')
    must((await lastChange())?.id === recorded?.id, 'no removal to change who may use the computer')
  } finally {
    inDatabase(
      stack.mongoUri,
      `await db.collection('agent_conversations').deleteMany({ sessionId: process.argv[2] })`,
      sessionId,
    )
    await owner('PUT', share, { level: 'off', everyone: false, userIds: [], managerIds: [] })
  }
}

export const chatComputerUseScenarios: Scenario[] = [
  {
    name: 'removing someone from a chat, or undoing their invite, leaves their computer use',
    run: async (page, stack) => removalKeepsComputerFlow(page, stack),
    // The first invite asks before giving use of the computer, on purpose.
    expected: /"error_code":"computer_use_required"/,
  },
]
