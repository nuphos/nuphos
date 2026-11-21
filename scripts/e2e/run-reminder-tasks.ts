// Scheduled work a Bot must confirm, on a real backend and OpenAB runtime. The app's chat route
// starts the conversations; due work reaches a scripted agent as a turn, and that agent confirms
// over REST with its own session's token.
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

type Json = Record<string, any>

const { MongoClient, ObjectId } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
const SWEEP_WAIT_MS = 70_000
let failed = false

const check = (label: string, ok: boolean, detail = '') => {
  const suffix = detail ? ` (${detail})` : ''

  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${suffix}`)
  if (!ok) failed = true
}
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const inSeconds = (n: number) => new Date(Date.now() + n * 1000).toISOString()

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const as = client(stack.apiUrl, stack.token)
  const mongo = await new MongoClient(stack.mongoUri).connect()
  const db = mongo.db('nuphos_e2e')
  const reminders = db.collection('agent_reminders')
  const messages = db.collection('agent_messages')

  const say = async (id: string, text: string) => {
    const sent = await as('POST', '/agent/chat', {
      id,
      teamId: stack.teamId,
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    })

    must(sent.status === 200, `chat to start, got ${sent.text}`)
  }
  const transcript = async (id: string) =>
    (await messages.find({ sessionId: id }).toArray()).map((row) => JSON.stringify(row))
  const turnsFor = async (id: string, occurrence: string) =>
    (await transcript(id)).filter((row) => row.includes(`Scheduled work ${occurrence}`)).length
  const workAcks = (occurrence: string) =>
    agentLog(stack).filter((entry) => entry.event === 'work-ack' && entry.name === occurrence)
  const state = async (id: string) => (await as('GET', `/agent/reminders/${id}`)).body as Json
  const schedule = async (session: string, text: string) => {
    const made = await as('POST', '/agent/reminders', {
      sessionId: session,
      kind: 'task',
      text,
      dueAt: inSeconds(4),
    })

    must(made.status === 201, `task to be scheduled, got ${made.text}`)

    return (made.body as Json).id as string
  }
  const noticeCount = async (session: string, id: string) =>
    messages.countDocuments({ sessionId: session, messageId: `reminder-failed-${id}` })

  // One conversation per scenario: the scripted agent reads markers from what it was sent.
  const fresh = async (name: string) => {
    const id = randomUUID()

    await say(id, `E2E_DELIVERY:${name}`)
    await until(`${name} to answer`, async () =>
      (await transcript(id)).join('').includes(`ACK E2E_DELIVERY:${name}`),
    )

    return id
  }
  const a = await fresh('a')
  const b = await fresh('b')
  const c = await fresh('c')
  const d = await fresh('d')

  // 1. The Bot does the work and confirms: delivered, by one turn.
  const done = await schedule(a, 'Write the report E2E_ACK_WORK:done E2E_DELIVERY:done')

  await until(
    'the task to be confirmed',
    async () => (await state(done)).status === 'delivered',
    150_000,
  )
  check('a Bot that confirms completes the work', (await state(done)).ackedAt !== undefined)
  check('the work was handed over as exactly one turn', (await turnsFor(a, done)) === 1)
  check(
    'the confirmation came from the owning conversation',
    workAcks(done).some((entry) => (entry.result as Json).status === 200),
  )

  // 2. Repeating it changes nothing; contradicting it, or confirming from elsewhere, is refused.
  const ackedAt = (await state(done)).ackedAt

  await say(a, `E2E_ACK_ID:${done} E2E_ACK_WORK:done E2E_DELIVERY:again`)
  await say(a, `E2E_ACK_ID:${done} E2E_ACK_WORK:failed E2E_DELIVERY:conflict`)
  await say(b, `E2E_ACK_ID:${done} E2E_ACK_WORK:done E2E_DELIVERY:foreign`)
  await until('the three attempts to be logged', async () => workAcks(done).length >= 4, 90_000)
  const codes = workAcks(done).map((entry) => (entry.result as Json).status)
  const owner = await as('POST', `/agent/reminders/${done}/ack`, { outcome: 'done' })

  check(
    'a repeated confirmation is accepted and changes nothing',
    (await state(done)).ackedAt === ackedAt,
  )
  check('a contradicting confirmation is refused', codes.includes(409), codes.join(','))
  check('another conversation cannot confirm it', codes.includes(404), codes.join(','))
  check(
    'the owner outside that conversation cannot confirm it',
    owner.status === 403,
    String(owner.status),
  )
  check('none of that ran the work again', (await turnsFor(a, done)) === 1)

  // 3. The Bot says it cannot: failed, one notice.
  const bad = await schedule(c, 'Rotate the key E2E_ACK_WORK:failed E2E_DELIVERY:bad')

  await until('the task to fail', async () => (await state(bad)).status === 'failed', 150_000)
  await until('the failure notice', async () => (await noticeCount(c, bad)) === 1, 150_000)
  check(
    'a Bot that reports failure fails the work and the owner gets one notice',
    (await state(bad)).failureReason === 'e2e says so',
  )

  // 4. Nobody confirms: dispatched, never replayed, then unconfirmed with one notice.
  const silent = await schedule(d, 'Send the mail E2E_DELIVERY:silent')

  await until(
    'the task to be dispatched',
    async () => (await state(silent)).status === 'dispatched',
    150_000,
  )
  check(
    'an unconfirmed task is dispatched but not done',
    (await state(silent)).ackedAt === undefined,
  )
  await reminders.updateOne(
    { _id: new ObjectId(silent) },
    { $set: { dispatchedAt: new Date(Date.now() - 20 * 60_000) } },
  )
  await until(
    'the task to become unconfirmed',
    async () => (await state(silent)).status === 'unconfirmed',
    150_000,
  )
  await until('the unconfirmed notice', async () => (await noticeCount(d, silent)) === 1, 150_000)
  await wait(SWEEP_WAIT_MS)
  check(
    'an unconfirmed task is not run again',
    (await turnsFor(d, silent)) === 1 && (await state(silent)).attempts === 1,
  )
  check('its owner gets exactly one notice', (await noticeCount(d, silent)) === 1)
  await mongo.close()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
