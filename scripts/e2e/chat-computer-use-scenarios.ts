// Scenarios about what a chat on someone's computer gives the people invited to it: use of the
// whole computer, which removing them from the chat does not take back unless its owner says so.
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
export async function stopComputerUseFlow(
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
  const sessionId = `e2e-stop-use-${randomUUID()}`
  const usersChat = `e2e-stop-use-${randomUUID()}`
  const chat = `/agent/conversations/${sessionId}/participants`
  const scope = `?teamId=${stack.teamId}`
  const stop = (as: Client, path: string, id: string) =>
    as('POST', `${path}/${id}/stop-computer-use${scope}`)
  const access = async (as: Client) => {
    const listed = (await as('GET', `/agent/devices${scope}`)).body as {
      devices: { deviceId: string; label?: string; access?: string }[]
    }

    return listed.devices.find((device) => device.deviceId === deviceId)
  }

  try {
    chatOn(stack, sessionId, ownerId, runtimeId)
    must((await access(invitee.member)) === undefined, 'the invitee not to use the computer yet')

    // Inviting asks first, naming the computer, then gives the invitee use of it.
    const asked = await owner('POST', `${chat}${scope}`, {
      userIds: [invitee.id],
      grantComputerUse: false,
    })
    const label = (await access(owner))?.label ?? ''
    const named = (asked.body as { error?: { details?: { computer?: { label?: string } } } }).error
      ?.details?.computer?.label

    log(`invite unconfirmed: ${String(asked.status)} ${asked.text.slice(0, 200)}`)
    must(
      asked.status === 409 && code(asked) === 'computer_use_required' && named === label,
      'the invite to ask before giving use of the computer, naming it',
    )
    const invited = await owner('POST', `${chat}${scope}`, {
      userIds: [invitee.id],
      grantComputerUse: true,
    })

    must(invited.status === 200, `the confirmed invite to land, got ${String(invited.status)}`)
    must((await access(invitee.member))?.access === 'use', 'the invitee to use the computer')

    // While they are in the chat, the chat cannot take the computer from them.
    const early = await stop(owner, chat, invitee.id)

    log(`stop while still in the chat: ${String(early.status)} ${String(code(early))}`)
    must(early.status === 409 && code(early) === 'still_participant', 'a participant to be kept')

    // Removing them keeps their use of the computer, and offers to stop it.
    const removed = await owner('DELETE', `${chat}/${invitee.id}${scope}`)
    const offer = (removed.body as { computerStillShared?: { deviceId: string; label: string } })
      .computerStillShared

    log(`removal: ${String(removed.status)} offer ${JSON.stringify(offer)}`)
    must(removed.status === 200, `the removal to land, got ${String(removed.status)}`)
    must(
      offer?.deviceId === deviceId && offer.label === label,
      'the removal to offer stopping use of this computer',
    )
    must((await access(invitee.member))?.access === 'use', 'removal alone to leave them use')

    // Refused to anyone but the chat's owner, and to a chat owner who only uses the computer.
    const notOwner = await stop(user.member, chat, invitee.id)

    log(`stop by someone who does not own the chat: ${String(notOwner.status)}`)
    must(notOwner.status === 403, `one who does not own the chat to be refused`)
    chatOn(stack, usersChat, user.id, runtimeId)
    const notManager = await stop(
      user.member,
      `/agent/conversations/${usersChat}/participants`,
      invitee.id,
    )

    log(`stop by a chat owner who does not manage the computer: ${String(notManager.status)}`)
    must(
      notManager.status === 409 && code(notManager) === 'nothing_to_stop',
      'a chat owner who only uses the computer to have nothing to stop',
    )
    must((await access(invitee.member))?.access === 'use', 'the refusals to change nothing')

    // The owner stops it: one positional pull on the grant takes only the invitee off.
    const stopped = await stop(owner, chat, invitee.id)

    log(`stop: ${String(stopped.status)} ${stopped.text.slice(0, 200)}`)
    must(stopped.status === 200, `the owner's stop to land, got ${String(stopped.status)}`)
    must((await access(invitee.member)) === undefined, 'the invitee no longer to use it')
    must((await access(user.member))?.access === 'use', 'the other teammate to keep using it')
    const again = await stop(owner, chat, invitee.id)

    must(
      again.status === 409 && code(again) === 'nothing_to_stop',
      'a second stop to find nothing to stop',
    )

    // The change is audited as a chat removal, by the owner.
    const audit = (await owner('GET', `/agent/devices/${deviceId}/access-audit${scope}`)).body as {
      entries: { via: string; actorUserId: string; next: { userIds: string[] } | null }[]
    }
    const entry = audit.entries.find((item) => item.via === 'conversation_remove')

    must(
      entry?.actorUserId === ownerId &&
        !entry.next?.userIds.includes(invitee.id) &&
        entry.next?.userIds.includes(user.id) === true,
      'the access history to record the stop as a chat removal',
    )
  } finally {
    inDatabase(
      stack.mongoUri,
      `await db.collection('agent_conversations').deleteMany({ sessionId: { $in: process.argv.slice(2) } })`,
      sessionId,
      usersChat,
    )
    await owner('PUT', share, { level: 'off', everyone: false, userIds: [], managerIds: [] })
  }
}

export const chatComputerUseScenarios: Scenario[] = [
  {
    name: 'a chat owner stops computer use for a removed participant',
    run: async (page, stack) => stopComputerUseFlow(page, stack),
    // The invite asks first, and each refusal the flow checks is answered on purpose.
    expected:
      /"error_code":"(computer_use_required|still_participant|conversation_read_only|nothing_to_stop)"/,
  },
]
