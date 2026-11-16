// The stack under test: a real MongoDB, backend and OpenAB, with a deterministic
// ACP agent in place of a model. Nothing here talks to the internet.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { artifacts, freePorts, logPath, spawn, stop, until } from './processes.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const BACKEND_DIR = join(ROOT, 'apps/backend')
const PANEL_JOB = resolve(import.meta.dirname, '../../apps/runtime/image/panel-job.mjs')
const FIXTURE = join(import.meta.dirname, 'acp-fixture.mjs')
const AUTH_KEY = 'local-e2e-openab-transport-key-123456789'
const CONTROL_KEY = 'local-e2e-openab-control-key-123456789'
const MONGO_IMAGE = 'mongo:8.0.32'

export type Stack = {
  apiUrl: string
  email: string
  token: string
  teamId: string
  /** One JSON line per turn the fixture agent started or finished. */
  acpLog: string
  signInCode: typeof signInCode
  /** Keeps the agent from opening new sessions, as a slow start does, until the returned function is called. */
  holdSessionOpening: () => () => void
  /** Stops OpenAB and its agents, runs `whileDown`, then starts it again on the same address, as a runtime restart does. With `panelJob` it comes back offering the runtime image's `panel` job. */
  restartAgentHost: (whileDown?: () => Promise<void>, panelJob?: boolean) => Promise<void>
}

function findOpenab(): string {
  const explicit = process.env.OPENAB ?? process.env.NUPHOS_OPENAB_BINARY

  if (explicit) return explicit
  const cache = join(homedir(), '.cache/nuphos')
  const built = existsSync(cache)
    ? readdirSync(cache, { recursive: true, encoding: 'utf8' }).find((path) =>
        /^openab-[^/]+\/target\/[^/]+\/release\/openab$/.test(path),
      )
    : undefined

  if (built) return join(cache, built)
  throw new Error(
    'No openab binary. Build one with `node apps/desktop/local-runtime/prepare.mjs`, or set OPENAB to an existing one.',
  )
}

function onPath(command: string): boolean {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0
}

/** E2E_MONGODB_URI, else a mongod on this computer (MONGOD names it), else the compose stack's image. */
function startMongo(freePort: number): string {
  if (process.env.E2E_MONGODB_URI) return process.env.E2E_MONGODB_URI
  const port = String(freePort)
  const mongod = process.env.MONGOD ?? 'mongod'

  if (onPath(mongod)) {
    const dbpath = join(artifacts, 'mongo')

    mkdirSync(dbpath, { recursive: true })
    spawn('mongo', [
      mongod,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      port,
      '--dbpath',
      dbpath,
      '--replSet',
      'rs0',
    ])
  } else {
    // Kernel 6.19+: let glibc own rseq, as deploy/compose does (SERVER-121912).
    const run = ['docker', 'run', '--rm', '-e', 'GLIBC_TUNABLES=glibc.pthread.rseq=1']

    // The same port inside and out, so the replica set's one member is the address we dial.
    const publish = ['-p', `127.0.0.1:${port}:${port}`]

    spawn('mongo', [...run, ...publish, MONGO_IMAGE, '--replSet', 'rs0', '--port', port])
  }

  return `mongodb://127.0.0.1:${port}/?directConnection=true`
}

/** The backend needs transactions, so a lone mongod becomes a one-member replica set. */
function initiateReplicaSet(uri: string): boolean {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1], { serverSelectionTimeoutMS: 1000 }).connect()
    const admin = client.db('admin')
    const host = new URL(process.argv[1]).host
    await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host }] } }).catch(() => {})
    const { ismaster } = await admin.command({ hello: 1 }).then((r) => ({ ismaster: r.isWritablePrimary }))
    await client.close()
    process.exit(ismaster ? 0 : 1)`

  try {
    execFileSync('bun', ['-e', script, uri], { cwd: BACKEND_DIR, stdio: 'ignore', timeout: 10_000 })

    return true
  } catch {
    return false
  }
}

/** The newest six-digit sign-in code the backend logged for this address. */
function signInCode(address: string): string | undefined {
  return readFileSync(logPath('backend'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(address) && line.includes('auth.email_otp.dev_code'))
    .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/.exec(line)?.[1])
    .findLast(Boolean)
}

export async function startStack(): Promise<Stack> {
  const [mongoPort, backendPort, runtimePort, secondRuntimePort] = await freePorts(4)
  const mongoUri = startMongo(mongoPort)

  await until('MongoDB to become primary', async () => initiateReplicaSet(mongoUri))
  const apiUrl = `http://127.0.0.1:${String(backendPort)}`
  const acpLog = join(artifacts, 'acp.jsonl')
  const holdOpening = join(artifacts, 'hold-opening')
  const holdSessionOpening = () => {
    writeFileSync(holdOpening, '')

    return () => rmSync(holdOpening)
  }

  writeFileSync(acpLog, '')
  // One OpenAB per runtime. The fixture logs `agent` with every entry, and each
  // OpenAB keeps its session files in a home of its own.
  const startAgentHost = (agent = 'first', port = runtimePort, panelJob = false) => {
    const config = join(artifacts, `openab-${agent}.toml`)
    const home = join(artifacts, `home-${agent}`)

    mkdirSync(home, { recursive: true })
    writeFileSync(
      config,
      [
        '[agent]',
        `command = ${JSON.stringify(process.execPath)}`,
        `args = [${JSON.stringify(FIXTURE)}]`,
        `working_dir = ${JSON.stringify(artifacts)}`,
        '[agent.env]',
        `E2E_ACP_LOG = ${JSON.stringify(acpLog)}`,
        `E2E_AGENT = ${JSON.stringify(agent)}`,
        `E2E_HOLD_OPENING = ${JSON.stringify(holdOpening)}`,
        '[pool]',
        'max_sessions = 4',
        'session_ttl_hours = 1',
        '',
      ].join('\n'),
    )

    return spawn(`openab-${agent}`, [findOpenab(), 'run', '-c', config], {
      env: {
        HOME: home,
        GATEWAY_ALLOWED_USERS: 'acp_client',
        OPENAB_ACP_ENABLED: 'true',
        OPENAB_ACP_AUTH_KEY: AUTH_KEY,
        OPENAB_ACP_CONTROL_KEY: CONTROL_KEY,
        OPENAB_ACP_MCP_SERVERS: 'true',
        GATEWAY_LISTEN: `127.0.0.1:${String(port)}`,
        // The runtime image's `panel` job: how the backend puts a file on a runtime and reads one back.
        ...(panelJob ? { OPENAB_RUNTIME_JOBS: `panel=${process.execPath} ${PANEL_JOB}` } : {}),
      },
    })
  }
  const agentHosts = [startAgentHost()]
  const restartAgentHost = async (whileDown?: () => Promise<void>, panelJob = false) => {
    await stop(agentHosts.at(-1)!)
    await whileDown?.()
    agentHosts.push(startAgentHost('first', runtimePort, panelJob))
    await until('OpenAB to listen again', async () =>
      fetch(`http://127.0.0.1:${String(runtimePort)}/`),
    )
  }

  spawn('backend', ['bun', 'run', 'src/index.ts'], {
    cwd: BACKEND_DIR,
    env: {
      NODE_ENV: 'development',
      PORT: String(backendPort),
      NUPHOS_JWT_SECRET: 'local-e2e-jwt-secret-not-a-production-credential',
      MONGODB_URI: mongoUri,
      MONGODB_DB: 'nuphos_e2e',
      ATLAS_REDIS_ENABLED: 'false',
      CLAUDE_CODE_RUNTIME_KUBECTL: 'false',
      CLAUDE_CODE_RUNTIME_PROVISIONER_ENABLED: 'false',
      NUPHOS_DEV_EMAIL_OTP_LOG: 'true',
      NUPHOS_LOCAL_STACK: 'true',
      // Where the agent reaches the backend's tools, as a runtime on this computer would.
      NUPHOS_BACKEND_URL: apiUrl,
    },
  })
  await until('the backend to be ready', async () => (await fetch(`${apiUrl}/health/ready`)).ok)

  const email = `e2e-${String(Date.now())}@example.com`
  let token = ''
  const post = async (path: string, body: unknown) => {
    const response = await fetch(apiUrl + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`${path} answered ${String(response.status)}: ${await response.text()}`)
    }

    return (await response.json()) as { token: string; team: { id: string } }
  }

  await post('/auth/email/request-code', { email })
  await until('the sign-in code to be logged', async () => signInCode(email))
  token = (await post('/auth/email/verify-code', { email, code: signInCode(email) })).token
  const teamId = (await post('/teams', { name: 'E2E' })).team.id

  // A second runtime, for work an agent delegates to another agent.
  startAgentHost('second', secondRuntimePort)
  for (const [port, label] of [
    [runtimePort, 'E2E fixture agent'],
    [secondRuntimePort, 'E2E second agent'],
  ] as const) {
    await until(`OpenAB on ${String(port)} to listen`, async () =>
      fetch(`http://127.0.0.1:${String(port)}/`),
    )
    await post(`/teams/${teamId}/agent-runtimes/external`, {
      url: `ws://127.0.0.1:${String(port)}/acp`,
      authKey: AUTH_KEY,
      controlKey: CONTROL_KEY,
      provider: 'claude-code',
      label,
    })
  }

  return { apiUrl, email, token, teamId, acpLog, signInCode, holdSessionOpening, restartAgentHost }
}
