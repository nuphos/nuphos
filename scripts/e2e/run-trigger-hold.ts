// A webhook Trigger with minIntervalSeconds against a real backend, MongoDB and Redis (with the
// Sentinel the backend requires): deliveries inside the window are kept, answered 202, and fired
// once when the window ends. Before the change the second delivery got 429 and was lost.
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
const DB = 'nuphos_e2e_trigger_hold'
const WINDOW_SECONDS = 8
const REDIS_SERVER = process.env.REDIS_SERVER ?? 'redis-server'
const REDIS_SENTINEL = process.env.REDIS_SENTINEL ?? 'redis-sentinel'
const [mongoPort, backendPort, redisPort, sentinelPort] = await freePorts(4)
const mongoUri = startMongo(mongoPort!)
const apiUrl = `http://127.0.0.1:${String(backendPort)}`
let token = ''
let failed = false

const startRedis = async () => {
  spawn('redis', [REDIS_SERVER, '--port', String(redisPort), '--bind', '127.0.0.1', '--save', ''])
  const sentinelConf = `${artifacts}/sentinel.conf`

  await Bun.write(
    sentinelConf,
    `port ${String(sentinelPort)}\nbind 127.0.0.1\nsentinel monitor mymaster 127.0.0.1 ${String(redisPort)} 1\n`,
  )
  spawn('sentinel', [REDIS_SENTINEL, sentinelConf])
  await until('Redis and Sentinel to answer', async () => {
    const out = await Bun.$`printf 'PING\r\n' | nc -w 1 127.0.0.1 ${redisPort}`.text()
    const sentinel =
      await Bun.$`printf 'SENTINEL get-master-addr-by-name mymaster\r\n' | nc -w 1 127.0.0.1 ${sentinelPort}`.text()

    return out.includes('PONG') && sentinel.includes(String(redisPort))
  })
}

const startBackend = async () => {
  spawn('backend', ['bun', 'run', 'src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      NODE_ENV: 'development',
      PORT: String(backendPort),
      NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
      MONGODB_URI: mongoUri,
      MONGODB_DB: DB,
      ATLAS_REDIS_ENABLED: 'true',
      ATLAS_REDIS_SENTINELS: `127.0.0.1:${String(sentinelPort)}`,
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
const check = (label: string, ok: boolean, detail = '') => {
  const suffix = detail ? ` (${detail})` : ''

  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${suffix}`)
  if (!ok) failed = true
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

try {
  console.log(`Artifacts: ${artifacts}`)
  await until('MongoDB to become primary', async () => initiateReplicaSet(mongoUri))
  await startRedis()
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
  const sessionId = `e2e-hold-${String(Date.now())}`

  await mongo.db(DB).collection('agent_conversations').insertOne({
    sessionId,
    teamId,
    userId,
    title: 'Hold',
    firstMessage: 'hi',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  })
  const trigger = await call('POST', '/agent/triggers', {
    teamId,
    name: 'hold check',
    triggerType: 'webhook',
    targetSessionId: sessionId,
    messageTemplate: 'Event: {{payload}}',
    minIntervalSeconds: WINDOW_SECONDS,
  })
  const hook = async (tag: string) => {
    const response = await fetch(`${apiUrl}/webhooks/${String(trigger.id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': trigger.webhookSecret },
      body: JSON.stringify({ tag }),
    })

    return { status: response.status, body: (await response.json()) as Json }
  }
  const triggers = mongo.db(DB).collection('agent_triggers')
  const heldCount = async () =>
    ((await triggers.findOne({ name: 'hold check' })) as Json | null)?.heldDeliveries?.length ?? 0
  const first = await hook('TAG-A')

  check('the first delivery opens the window', first.status === 200, String(first.status))
  const second = await hook('TAG-B')
  const third = await hook('TAG-C')

  check(
    'a delivery inside the window is kept, not rejected with 429',
    second.status === 202 && third.status === 202,
    `${String(second.status)} and ${String(third.status)}: ${JSON.stringify(second.body)}`,
  )
  check(
    'both are held on the Trigger',
    (await heldCount()) === 2,
    `held=${String(await heldCount())}`,
  )
  const opened = Date.now()

  await sleep((WINDOW_SECONDS + 6) * 1000)
  const fired = lines().filter((line) => line.includes('webhook.held_fired'))
  const firedAt = Date.parse(JSON.parse(fired[0] ?? '{"ts":0}').ts as string)

  check('nothing is held once the window has ended', (await heldCount()) === 0)
  check('the window ends with one fire', fired.length === 1, `${String(fired.length)} fires`)
  check(
    'that fire carries both held deliveries',
    JSON.parse(fired[0] ?? '{}').deliveries === 2,
    fired[0]?.slice(0, 160),
  )
  check(
    'it fires when the window ends, not before',
    firedAt - opened >= (WINDOW_SECONDS - 1) * 1000,
    `${String(firedAt - opened)} ms after the first delivery`,
  )
  const during = await hook('TAG-D')

  check('the flush opened a new window, so the next delivery is held again', during.status === 202)
  await sleep((WINDOW_SECONDS + 6) * 1000)
  const fires = lines().filter((line) => line.includes('webhook.held_fired'))

  check(
    'a delivery held right after a flush is fired by its own job, once and unwrapped',
    fires.length === 2 && JSON.parse(fires[1] ?? '{}').deliveries === 1,
    `${String(fires.length)} fires`,
  )
  const quiet = await hook('TAG-E')

  check(
    'once a window passes with nothing held, a delivery fires at once',
    quiet.status === 200,
    String(quiet.status),
  )
  await mongo.close()
} catch (error) {
  console.error(error)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
