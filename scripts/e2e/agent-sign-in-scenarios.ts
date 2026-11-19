// Scenarios about who signs the agents on a teammate's computer in (#2431): its owner and its
// managers do, those who only use it ask them.
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
function inDatabase(mongoUri: string, script: string, ...args: string[]): string {
  const run = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    ${script}
    await client.close()`

  return execFileSync('bun', ['-e', run, mongoUri, ...args], { cwd: BACKEND_DIR, timeout: 10_000 })
    .toString()
    .trim()
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

// The app's own computer stands in for the teammate's: the stack's user owns it, shares it with
// a manager and with someone who only uses it, and each of them meets its Claude Code agent.
export async function managerSignInFlow(
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
  const manager = await join(stack, owner, 'manager')
  const user = await join(stack, owner, 'user')
  const share = `/agent/devices/${deviceId}/share?teamId=${stack.teamId}`
  const shared = await owner('PUT', share, {
    level: 'full',
    everyone: false,
    userIds: [manager.id, user.id],
    managerIds: [manager.id],
  })

  must(
    shared.status === 200,
    `the computer to be shared, got ${String(shared.status)} ${shared.text}`,
  )
  const runtimeId = `local_${ownerId}_${deviceId}`
  const team = `/teams/${stack.teamId}/agent-runtimes/${runtimeId}`
  const sessionId = `e2e-sign-in-${randomUUID()}`

  try {
    // What the app reads to offer the Sign in dialog: the computer, and how far each may go on it.
    const access = async (as: Client) => {
      const listed = (await as('GET', `/agent/devices?teamId=${stack.teamId}`)).body as {
        devices: { deviceId: string; access?: string }[]
      }

      return listed.devices.find((device) => device.deviceId === deviceId)?.access
    }

    must((await access(manager.member)) === 'manage', 'the manager to be listed as managing it')
    must((await access(user.member)) === 'use', 'the other teammate to be listed as using it')

    // Signing its agent in: the manager's attempt starts, the other teammate is refused.
    const started = await manager.member('POST', `${team}/login`)

    log(`manager signs in: ${String(started.status)} ${started.text.slice(0, 200)}`)
    must(started.status === 202, `the manager's sign-in to start, got ${String(started.status)}`)
    const { attemptId } = started.body as { attemptId?: string }
    const refused = await user.member('POST', `${team}/login`)

    log(`teammate who only uses it signs in: ${String(refused.status)}`)
    must(
      refused.status === 403,
      `one who only uses it to be refused, got ${String(refused.status)}`,
    )
    if (attemptId) await manager.member('DELETE', `${team}/login`, { attemptId })

    // Asking to sign it in, from a conversation the teammate has on it. The conversation is
    // set up in the database: the suite's fixture agent is not this computer's own agent.
    inDatabase(
      stack.mongoUri,
      `const now = new Date()
      await db.collection('agent_conversations').insertOne({ sessionId: process.argv[2],
        teamId: process.argv[3], userId: process.argv[4], runtimeId: process.argv[5],
        runtimeLabel: 'Claude Code', title: 'Needs a sign-in', createdAt: now, updatedAt: now })`,
      sessionId,
      stack.teamId,
      user.id,
      runtimeId,
    )
    const ask = async (as: Client) => as('POST', `${team}/sign-in-requests`, { sessionId })
    const asked = await ask(user.member)

    log(`teammate asks: ${String(asked.status)} ${asked.text.slice(0, 200)}`)
    must(asked.status === 200, `the teammate's ask to be taken, got ${String(asked.status)}`)
    const askedUserIds = JSON.parse(
      inDatabase(
        stack.mongoUri,
        `const row = await db.collection('agent_conversations').findOne({ sessionId: process.argv[2] })
        console.log(JSON.stringify(row?.signInRequest?.askedUserIds ?? []))`,
        sessionId,
      ),
    ) as string[]

    log(`asked: ${JSON.stringify(askedUserIds)}`)
    must(
      JSON.stringify(askedUserIds) === JSON.stringify([ownerId, manager.id]),
      'the ask to reach the owner first, then the manager',
    )
    const own = await ask(manager.member)

    log(`manager asks: ${String(own.status)} ${own.text.slice(0, 200)}`)
    must(
      own.status === 409 && own.text.includes('can_sign_in'),
      'the manager to be told they can sign it in themselves',
    )
  } finally {
    inDatabase(
      stack.mongoUri,
      `await db.collection('agent_conversations').deleteOne({ sessionId: process.argv[2] })`,
      sessionId,
    )
    await owner('PUT', share, { level: 'off', everyone: false, userIds: [], managerIds: [] })
  }
}

// Refused on purpose: signing the agent in as one who only uses the computer, and asking
// someone to sign it in as one who manages it.
const REFUSED_SIGN_IN =
  /\/agent-runtimes\/local_[^"/]+\/login","status":403,"error_code":"forbidden"|"error_code":"can_sign_in"/

export const agentSignInScenarios: Scenario[] = [
  {
    name: "a manager of a teammate's computer signs its agent in; one who only uses it asks",
    run: async (page, stack) => managerSignInFlow(page, stack),
    expected: REFUSED_SIGN_IN,
  },
]
