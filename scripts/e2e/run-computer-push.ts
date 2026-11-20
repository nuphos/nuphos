// A real backend + MongoDB + WebSocket presence run. Only APNs is captured.
// Run with: bun scripts/e2e/run-computer-push.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { artifacts, freePorts, logPath, spawn, stopAll, until } from './processes.ts'

const backendDir = resolve(import.meta.dirname, '../../apps/backend')
const [mongoPort, backendPort] = await freePorts(2)
const mongoUri = `mongodb://127.0.0.1:${mongoPort}/?directConnection=true`
const api = `http://127.0.0.1:${backendPort}`
const capture = join(artifacts, 'pushes.jsonl')

writeFileSync(capture, '')
const pushes = () =>
  readFileSync(capture, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const sockets: WebSocket[] = []
let token = ''

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(api + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  assert(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`)

  return response.json() as Promise<any>
}
async function online(id: string) {
  await request('PUT', '/agent/devices', {
    deviceId: id,
    label: id,
    platform: 'darwin',
    allowLocalExec: true,
  })
  const ws = new WebSocket(`${api.replace('http', 'ws')}/agent/devices/${id}/runtime-tunnel`, {
    headers: { authorization: `Bearer ${token}` },
  } as unknown as string[])

  sockets.push(ws)
  ws.addEventListener('message', () => ws.send(JSON.stringify({ t: 'pong' })))
  await new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done(), { once: true })
    ws.addEventListener('error', fail, { once: true })
  })
  // A socket alone is not presence: the holder claims it on its first frame.
  ws.send(JSON.stringify({ t: 'status', status: { agents: {} } }))
  await new Promise((done) => setTimeout(done, 500))

  return ws
}
try {
  spawn('mongo', [
    'docker',
    'run',
    '--rm',
    '-p',
    `127.0.0.1:${mongoPort}:${mongoPort}`,
    'mongo:8.0.32',
    '--replSet',
    'rs0',
    '--port',
    String(mongoPort),
  ])
  await until('Mongo primary', async () => {
    try {
      execFileSync(
        'bun',
        [
          '-e',
          `import { MongoClient } from 'mongodb'; const c = await new MongoClient(process.argv[1], {serverSelectionTimeoutMS:500}).connect(); const a=c.db('admin'); await a.command({replSetInitiate:{_id:'rs0',members:[{_id:0,host:new URL(process.argv[1]).host}]}}).catch(()=>{}); const h=await a.command({hello:1}); await c.close(); process.exit(h.isWritablePrimary?0:1)`,
          mongoUri,
        ],
        { cwd: backendDir, timeout: 3000, stdio: 'ignore' },
      )

      return true
    } catch {
      return false
    }
  })
  spawn(
    'backend',
    [
      'bun',
      'run',
      '--preload',
      resolve(import.meta.dirname, 'computer-push-sender.ts'),
      'src/index.ts',
    ],
    {
      cwd: backendDir,
      env: {
        NODE_ENV: 'development',
        PORT: String(backendPort),
        MONGODB_URI: mongoUri,
        MONGODB_DB: 'computer_push_e2e',
        NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
        ATLAS_REDIS_ENABLED: 'false',
        NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
        NUPHOS_LOCAL_STACK: 'true',
        E2E_PUSH_CAPTURE: capture,
      },
    },
  )
  await until('backend ready', async () => (await fetch(`${api}/health/ready`)).ok)
  const email = 'computer-push-e2e@example.com'

  await request('POST', '/auth/email/request-code', { email })
  let code = ''

  await until('email code', async () => {
    code =
      readFileSync(logPath('backend'), 'utf8')
        .split('\n')
        .filter((line) => line.includes(email) && line.includes('auth.email_otp.dev_code'))
        .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/.exec(line)?.[1])
        .findLast(Boolean) ?? ''

    return Boolean(code)
  })
  token = (await request('POST', '/auth/email/verify-code', { email, code })).token
  await request('PUT', '/push/devices', {
    token: 'ab'.repeat(32),
    deviceId: 'e2e-phone',
    platform: 'ios',
    environment: 'sandbox',
    computerAlerts: true,
  })
  assert.deepEqual(await request('GET', '/push/computer-subscriptions'), { deviceIds: [] })
  const subscribed = await online('subscribed-computer')
  const silent = await online('unsubscribed-computer')

  await request('PUT', '/push/computer-subscriptions/subscribed-computer', { enabled: true })
  assert.deepEqual(await request('GET', '/push/computer-subscriptions'), {
    deviceIds: ['subscribed-computer'],
  })
  const disconnected = Date.now()

  subscribed.close()
  silent.close()
  console.log('Both tunnels disconnected; checking the real 120-second grace period.')
  await new Promise((done) => setTimeout(done, 110_000))
  assert.equal(pushes().length, 0, 'no push before the grace period')
  await until('subscribed offline push', async () => pushes().length > 0, 30_000)
  const offline = pushes()

  assert.equal(offline.length, 1)
  assert.equal(offline[0].request.collapseId, 'computer:subscribed-computer')
  assert.equal(offline[0].request.payload.aps.alert.title, 'subscribed-computer is offline')
  assert(offline[0].at - disconnected >= 120_000, 'full grace period elapsed')
  await new Promise((done) => setTimeout(done, 3000))
  assert.equal(pushes().length, 1, 'unsubscribed computer remains silent')
  await online('subscribed-computer')
  await until('recovery push', async () => pushes().length === 2)
  assert.equal(pushes()[1].request.payload.aps.alert.title, 'subscribed-computer is back online')
  console.log(
    JSON.stringify(
      { result: 'PASS', offlineDelayMs: offline[0].at - disconnected, pushes: pushes(), artifacts },
      null,
      2,
    ),
  )
} finally {
  for (const ws of sockets) ws.close()
  await stopAll()
}
