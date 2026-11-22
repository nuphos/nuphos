// Webhook Trigger payload filters against a real backend and MongoDB: a delivery that fails the
// rules starts no turn, one that passes does, and the rules can be changed and cleared.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { artifacts, freePorts, logPath, spawn, stopAll, until } from './processes.ts'
import { initiateReplicaSet, startMongo } from './stack.ts'

type Json = Record<string, any>

// The root has no mongodb package; the backend's is the one the stack under test uses.
const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const DB = 'nuphos_e2e_trigger_filters'
const [mongoPort, backendPort] = await freePorts(2)
const mongoUri = startMongo(mongoPort!)
const apiUrl = `http://127.0.0.1:${String(backendPort)}`
let token = ''
let failed = false

const startBackend = async () => {
  spawn('backend', ['bun', 'run', 'src/index.ts'], {
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
  const make = (filters?: unknown) =>
    call('POST', '/agent/triggers', {
      teamId,
      name: 'pr events',
      triggerType: 'webhook',
      targetSessionId: sessionId,
      messageTemplate: 'PR event: {{payload}}',
      ...(filters === undefined ? {} : { payloadFilters: filters }),
    })
  const hook = async (trigger: Json, body: unknown) => {
    const response = await fetch(`${apiUrl}/webhooks/${String(trigger.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': trigger.webhookSecret },
      body: JSON.stringify(body),
    })

    return { status: response.status, body: (await response.json()) as Json }
  }
  // No runtime is set up here, so a delivery that reaches the Trigger's turn fails there, loudly.
  const fires = () => count('webhook.trigger_execution_failed')
  const rules = [
    { path: 'action', in: ['opened', 'synchronize'] },
    { path: 'sender.login', notIn: ['ci[bot]'] },
  ]
  const trigger = await make(rules)

  check('the rules are stored with the Trigger', trigger.payloadFilters?.length === 2)
  const labeled = await hook(trigger, { action: 'labeled', sender: { login: 'me' }, tag: 'E1' })

  check(
    'a delivery outside the allowlist is answered as filtered',
    labeled.status === 200 && labeled.body.reason === 'filtered',
    JSON.stringify(labeled.body),
  )
  const bot = await hook(trigger, { action: 'opened', sender: { login: 'ci[bot]' }, tag: 'E2' })

  check('a delivery from an excluded sender is filtered', bot.body.reason === 'filtered')
  const opened = await hook(trigger, { action: 'opened', sender: { login: 'me' }, tag: 'E3' })

  check('a matching delivery is accepted', opened.status === 200 && opened.body.ok === true)
  await until('the matching delivery to start its turn', async () => fires() === 1)
  check('filtered deliveries started no turn', fires() === 1)

  await call('PATCH', `/agent/triggers/${String(trigger.id)}`, { teamId, payloadFilters: [] })
  const cleared = await call('GET', `/agent/triggers/${String(trigger.id)}?teamId=${teamId}`)

  check('an empty list removes the rules', cleared.payloadFilters === undefined)
  const all = await hook(trigger, { action: 'labeled', sender: { login: 'me' }, tag: 'E4' })

  await until('the unfiltered delivery to start its turn', async () => fires() === 2)
  check('with no rules every delivery fires again', all.body.ok === true && !all.body.skipped)
  const bad = await fetch(`${apiUrl}/agent/triggers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      teamId,
      name: 'bad',
      triggerType: 'webhook',
      targetSessionId: sessionId,
      messageTemplate: 'x',
      payloadFilters: [{ path: 'a', regex: '.*' }],
    }),
  })

  check('an expression-like rule is refused', bad.status === 400, String(bad.status))
  await mongo.close()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
