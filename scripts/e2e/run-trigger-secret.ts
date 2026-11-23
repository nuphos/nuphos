// A webhook Trigger's secret against a real backend and MongoDB: create and rotate return it, a
// read or a list never does, and rotating replaces it at once.
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
const DB = 'nuphos_e2e_trigger_secret'
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
  const sessionId = `e2e-secret-${String(Date.now())}`

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
  const trigger = await call('POST', '/agent/triggers', {
    teamId,
    name: 'secret check',
    triggerType: 'webhook',
    targetSessionId: sessionId,
    messageTemplate: 'Event: {{payload}}',
  })
  const secret = trigger.webhookSecret as string
  const hook = async (value: string) =>
    (
      await fetch(`${apiUrl}/webhooks/${String(trigger.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': value },
        body: JSON.stringify({ tag: 'S1' }),
      })
    ).status

  check('create returns the secret once', typeof secret === 'string' && secret.length >= 32)
  const read = await call('GET', `/agent/triggers/${String(trigger.id)}?teamId=${teamId}`)

  check('a read by the owner returns no secret', !JSON.stringify(read).includes(secret))
  check('the owner can still manage it', read.canManage === true)
  const list = await call('GET', `/agent/triggers?teamId=${teamId}`)

  check('the list returns no secret', !JSON.stringify(list).includes(secret))
  check('the created secret delivers', (await hook(secret)) === 200)
  const rotated = await call(
    'POST',
    `/agent/triggers/${String(trigger.id)}/rotate-secret?teamId=${teamId}`,
  )

  check('rotate returns a new secret', rotated.webhookSecret && rotated.webhookSecret !== secret)
  check('the old secret is refused at once', (await hook(secret)) === 401)
  check('the new secret delivers', (await hook(rotated.webhookSecret as string)) === 200)
  const after = await call('GET', `/agent/triggers/${String(trigger.id)}?teamId=${teamId}`)

  check(
    'a read after rotating returns no secret',
    !JSON.stringify(after).includes(rotated.webhookSecret as string),
  )
  await mongo.close()
} catch (error) {
  console.error(error)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
