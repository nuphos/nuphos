// #4218, `bun scripts/e2e/run-probe-deadline.ts`: a real backend and MongoDB, a computer holding
// a real runtime tunnel, and a Trigger fired on a conversation pinned to it. The computer answers
// every ACP call, but takes SLOW_MS over the first state call of a tunnel, as a reconnect does.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { freePorts, logPath, spawn, stopAll, until } from './processes.ts'

const SLOW_MS = 6_000
const backendDir = resolve(import.meta.dirname, '../../apps/backend')
const [mongoPort, backendPort] = await freePorts(2)
const mongoUri = `mongodb://127.0.0.1:${mongoPort}/?directConnection=true`
const api = `http://127.0.0.1:${backendPort}`
const DB = 'probe_deadline_e2e'
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
  const text = await response.text()

  if (!response.ok) throw new Error(`${method} ${path}: ${String(response.status)} ${text}`)

  return text ? (JSON.parse(text) as Record<string, string & Record<string, string>>) : {}
}

function inDatabase(program: string, ...args: string[]) {
  return execFileSync('bun', ['-e', program, mongoUri, DB, ...args], {
    cwd: backendDir,
    encoding: 'utf8',
  })
}

const INSERT = `import { MongoClient } from 'mongodb'
const c = await new MongoClient(process.argv[1]).connect()
const now = new Date()
await c.db(process.argv[2]).collection('agent_conversations').insertOne({
  sessionId: process.argv[3], teamId: process.argv[4], userId: process.argv[5],
  runtimeId: process.argv[6], runtimeLabel: 'Claude Code', title: 'Probe deadline',
  agentRuntime: 'claude-code', messageCount: 2, createdAt: now, updatedAt: now,
  claudeCodePreview: { runtimeUrl: process.argv[7], openabSessionId: process.argv[8] },
})
await c.close()`

/** Every ACP call the agent answered, and when. */
const answered: string[] = []
const prompts: string[] = []
let tunnelGeneration = 0

/** A computer whose agent is slow over the first state call of each new tunnel. */
function hold(deviceId: string) {
  const ws = new WebSocket(
    `${api.replace('http', 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
    {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as string[],
  )
  const generation = ++tunnelGeneration
  let firstState = true

  ws.addEventListener('message', (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data)) as { t: string; s?: string; d?: string }

    ws.send(JSON.stringify({ t: 'pong' }))
    if (frame.t === 'open') ws.send(JSON.stringify({ t: 'opened', s: frame.s }))
    if (frame.t !== 'data' || !frame.d) return
    const call = JSON.parse(frame.d) as { id?: number; method?: string }

    if (call.id === undefined || !call.method) return
    const send = (result: unknown) =>
      ws.send(
        JSON.stringify({
          t: 'data',
          s: frame.s,
          d: JSON.stringify({ jsonrpc: '2.0', id: call.id, result }),
        }),
      )

    if (call.method === 'initialize')
      return send({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          _meta: { 'dev.openab/permissionRelay': true, 'dev.openab/sessionAuthority': 2 },
        },
        authMethods: [],
      })
    if (call.method === '_openab/session/state') {
      const slow = firstState

      firstState = false
      const delay = slow ? `, +${String(SLOW_MS)}ms` : ''
      const answer = () => {
        answered.push(`state(gen ${String(generation)}${delay})`)
        send({
          schemaVersion: 2,
          epoch: 'runtime',
          revision: 1,
          state: 'idle',
          phase: 'idle',
          label: 'Ready',
          tools: [],
          actions: { send: true, cancel: false, steer: false },
        })
      }

      if (slow) setTimeout(answer, SLOW_MS)
      else answer()

      return
    }
    if (call.method === 'session/prompt') {
      const blocks = (JSON.parse(frame.d) as { params?: { prompt?: { text?: string }[] } }).params
        ?.prompt

      prompts.push(blocks?.map((block) => block.text ?? '').join('') ?? '')

      return send({ stopReason: 'end_turn' })
    }
    answered.push(call.method)
    send({})
  })

  return new Promise<WebSocket>((opened, failed) => {
    ws.addEventListener('error', failed, { once: true })
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          t: 'status',
          status: {
            allowLocalExec: true,
            agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
          },
        }),
      )
      setTimeout(() => opened(ws), 500)
    })
  })
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
  spawn('backend', ['bun', 'run', 'src/index.ts'], {
    cwd: backendDir,
    env: {
      NODE_ENV: 'development',
      PORT: String(backendPort),
      MONGODB_URI: mongoUri,
      MONGODB_DB: DB,
      NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
      ATLAS_REDIS_ENABLED: 'false',
      NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
      NUPHOS_LOCAL_STACK: 'true',
    },
  })
  await until('backend ready', async () => (await fetch(`${api}/health/ready`)).ok)
  const email = 'probe-deadline-e2e@example.com'

  await request('POST', '/auth/email/request-code', { email })
  let code = ''

  await until('email code', async () => {
    code =
      readFileSync(logPath('backend'), 'utf8')
        .split('\n')
        .filter((line) => line.includes(email) && line.includes('auth.email_otp.dev_code'))
        .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/u.exec(line)?.[1])
        .findLast(Boolean) ?? ''

    return Boolean(code)
  })
  const signedIn = await request('POST', '/auth/email/verify-code', { email, code })

  token = signedIn.token as string
  const userId = (await request('GET', '/auth/me')).id as string
  const teamId = (await request('POST', '/teams', { name: 'Probe deadline' })).team.id as string
  const deviceId = `probe-${randomUUID().slice(0, 8)}`

  await request('PUT', '/agent/devices', {
    deviceId,
    label: 'E2E laptop',
    platform: 'darwin',
    allowLocalExec: true,
  })
  let tunnel = await hold(deviceId)
  const runtimeId = `local_${userId}_${deviceId}`
  const runtimeUrl = `nuphos-device://runtime/${userId}/${deviceId}?team=${teamId}`
  const sessionId = `probe-deadline-${randomUUID()}`

  inDatabase(INSERT, sessionId, teamId, userId, runtimeId, runtimeUrl, `sess_${randomUUID()}`)
  const trigger = (await request('POST', '/agent/triggers', {
    teamId,
    targetSessionId: sessionId,
    name: 'Hourly report',
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: 'Report E2E_PROBE_DEADLINE',
  })) as { id: string }

  // The customer's moment: the tunnel drops and comes straight back, and the fire lands on a
  // computer whose first control round trip is slow.
  tunnel.close()
  await new Promise((done) => setTimeout(done, 1_000))
  tunnel = await hold(deviceId)
  console.log(`[e2e] tunnel reconnected (generation ${String(tunnelGeneration)}); firing`)
  const firedAt = Date.now()

  await request('POST', `/agent/triggers/${trigger.id}/test-fire?teamId=${teamId}`)
  await until(
    'the fire to settle',
    async () => {
      const log = readFileSync(logPath('backend'), 'utf8')

      return prompts.length > 0 || log.includes('agent.runtime_state.probe_timeout')
    },
    30_000,
  ).catch(() => {})
  await new Promise((done) => setTimeout(done, 2_000))
  const log = readFileSync(logPath('backend'), 'utf8')
  const timedOut = log.includes('agent.runtime_state.probe_timeout')

  console.log(`[e2e] elapsed ${String(Date.now() - firedAt)}ms`)
  console.log(`[e2e] agent answered: ${JSON.stringify(answered)}`)
  console.log(`[e2e] prompts the agent received: ${JSON.stringify(prompts)}`)
  console.log(`[e2e] backend logged probe_timeout: ${String(timedOut)}`)
  tunnel.close()
  if (prompts.length !== 1 || timedOut)
    throw new Error('The turn was lost to the state check before the prompt')
  console.log('[e2e] PASS: a slow state answer after a reconnect kept the turn')
} finally {
  stopAll()
}
