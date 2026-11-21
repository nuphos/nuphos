// One-time reminders against a real backend and MongoDB, with faults: a backend down at the due
// time, a crash between save and ack, and a conversation that cannot receive it. No Desktop or
// agent runtime: a reminder is delivered without a Bot turn.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { artifacts, freePorts, logPath, spawn, stop, stopAll, until } from './processes.ts'
import { initiateReplicaSet, startMongo } from './stack.ts'

import type { ChildProcess } from 'node:child_process'

type Json = Record<string, any>

// The root has no mongodb package; the backend's is the one the stack under test uses.
const { MongoClient, ObjectId } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const DB = 'nuphos_e2e_reminders'
const SWEEP_WAIT_MS = 35_000
const [mongoPort, backendPort] = await freePorts(2)
const mongoUri = startMongo(mongoPort!)
const apiUrl = `http://127.0.0.1:${String(backendPort)}`
let backend: ChildProcess | undefined
let token = ''
let failed = false

const startBackend = async () => {
  backend = spawn('backend', ['bun', 'run', 'src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      NODE_ENV: 'development',
      PORT: String(backendPort),
      NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
      MONGODB_URI: mongoUri,
      MONGODB_DB: DB,
      ATLAS_REDIS_ENABLED: 'false',
      NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
      NUPHOS_LOCAL_STACK: 'true',
      NUPHOS_BACKEND_URL: apiUrl,
    },
  })
  await until('the backend to be ready', async () => (await fetch(`${apiUrl}/health/ready`)).ok)
}

const call = async (method: string, path: string, body?: unknown): Promise<Json> => {
  const response = await fetch(apiUrl + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()

  if (!response.ok)
    throw new Error(`${method} ${path} answered ${String(response.status)}: ${text}`)

  return JSON.parse(text) as Json
}

const lines = () => readFileSync(logPath('backend'), 'utf8').split('\n')
const count = (needle: string) => lines().filter((line) => line.includes(needle)).length
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const inSeconds = (n: number) => new Date(Date.now() + n * 1000).toISOString()
const check = (label: string, ok: boolean, detail = '') => {
  const suffix = detail ? ` (${detail})` : ''

  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${suffix}`)
  if (!ok) failed = true
}

try {
  console.log(`Artifacts: ${artifacts}`)
  await until('MongoDB to become primary', async () => initiateReplicaSet(mongoUri))
  await startBackend()
  const email = `e2e-${String(Date.now())}@example.com`
  const code = () =>
    lines()
      .filter((line) => line.includes(email) && line.includes('dev_code'))
      .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/.exec(line)?.[1])
      .findLast(Boolean)

  await call('POST', '/auth/email/request-code', { email })
  await until('the sign-in code', async () => code())
  token = (await call('POST', '/auth/email/verify-code', { email, code: code() })).token
  const teamId = (await call('POST', '/teams', { name: 'E2E' })).team.id as string
  const userId = (await call('GET', '/auth/me')).id as string
  const mongo = await new MongoClient(mongoUri).connect()
  const conversations = mongo.db(DB).collection('agent_conversations')
  const messages = mongo.db(DB).collection('agent_messages')
  const reminders = mongo.db(DB).collection('agent_reminders')
  const sessionId = `e2e-reminders-${String(Date.now())}`

  await conversations.insertOne({
    sessionId,
    teamId,
    userId,
    title: 'Reminders',
    firstMessage: 'hi',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  })
  const saved = (id: string) => messages.countDocuments({ sessionId, messageId: `reminder-${id}` })
  const state = (id: string) => call('GET', `/agent/reminders/${id}`)
  const delivered = async (id: string) => (await state(id)).status === 'delivered'
  const create = (dueAt: string, extra: object = {}) =>
    call('POST', '/agent/reminders', { sessionId, text: 'stand up', dueAt, ...extra })
  const dueNow = (id: string, extra: object = {}) => {
    const past = new Date(Date.now() - 1000)

    return reminders.updateOne(
      { _id: new ObjectId(id) },
      { $set: { dueAt: past, nextAttemptAt: past, ...extra } },
    )
  }

  // 1. On time, in a zone, with no Bot turn and no model.
  const wall = new Date(Date.now() + 5000)
    .toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' })
    .replace(' ', 'T')
  const early = await create(wall, { timeZone: 'Asia/Taipei' })

  check(
    'a local due time is stored as that instant in its zone',
    Math.abs(Date.parse(early.dueAt) - Date.now() - 5000) < 2000,
    early.dueAt,
  )
  check('it is not delivered before it is due', (await saved(early.id)) === 0)
  await until('the reminder to be delivered', async () => delivered(early.id), 70_000)
  check(
    'on time: delivered once into the conversation',
    (await saved(early.id)) === 1 && (await state(early.id)).ackedAt !== undefined,
  )

  // 2. The backend is down at the due time and comes back later.
  const missed = await create(inSeconds(4))

  await stop(backend!)
  await wait(6000)
  check('while the backend was down nothing was delivered', (await saved(missed.id)) === 0)
  await startBackend()
  await until('the overdue reminder to be delivered', async () => delivered(missed.id), 70_000)
  check(
    'catch-up: an overdue reminder is delivered after a restart',
    (await saved(missed.id)) === 1,
  )

  // 3. A crash between saving the reminder and acknowledging it.
  const crashed = await create(inSeconds(3600))

  await messages.insertOne({
    sessionId,
    userId,
    messageId: `reminder-${crashed.id}`,
    role: 'user',
    parts: [{ type: 'text', text: 'stand up' }],
    createdAt: new Date(),
  })
  await dueNow(crashed.id, { attempts: 1 })
  await until(
    'the half-delivered reminder to be acknowledged',
    async () => delivered(crashed.id),
    70_000,
  )
  const ackedAt = (await state(crashed.id)).ackedAt

  await wait(SWEEP_WAIT_MS)
  check(
    'crash after save, before ack: one visible reminder, acknowledged once',
    (await saved(crashed.id)) === 1 && (await state(crashed.id)).ackedAt === ackedAt,
  )

  // 4. The conversation can no longer receive it: the owner is told once, by the backend alone.
  const lost = await create(inSeconds(3600))
  const failedBefore = count('agent.reminder.failed')

  await conversations.updateOne({ sessionId }, { $set: { archivedAt: new Date() } })
  await dueNow(lost.id)
  await until(
    'the reminder to fail',
    async () => (await state(lost.id)).status === 'failed',
    70_000,
  )
  await wait(SWEEP_WAIT_MS)
  const failure = await state(lost.id)

  check(
    'unreachable conversation: failed with a reason',
    Boolean(failure.failureReason),
    failure.failureReason,
  )
  check('the owner is notified exactly once', count('agent.reminder.failed') === failedBefore + 1)
  check('nothing was saved', (await saved(lost.id)) === 0)
  check(
    'the failed reminder stays listed',
    (await call('GET', '/agent/reminders?status=failed')).reminders.some(
      (r: Json) => r.id === lost.id,
    ),
  )
  await mongo.close()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
