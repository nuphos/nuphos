// The stack under test: a real MongoDB, file store, backend and OpenAB, with a deterministic
// ACP agent in place of a model. Nothing here talks to the internet.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { artifacts, freePorts, frozen, logPath, spawn, stop, until } from './processes.ts'
import { startInstaboxStub } from './instabox-stub.ts'
import { startStorage } from './storage.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const FIXTURE = join(import.meta.dirname, 'acp-fixture.mjs')
const AUTH_KEY = 'local-e2e-openab-transport-key-123456789'
const CONTROL_KEY = 'local-e2e-openab-control-key-123456789'
const MONGO_IMAGE = 'mongo:8.0.32'

export type Stack = {
  apiUrl: string
  /** For what only the database can set up, such as a row that is gone. */
  mongoUri: string
  email: string
  token: string
  teamId: string
  /** One JSON line per turn the fixture agent started or finished. */
  acpLog: string
  signInCode: typeof signInCode
  /** Keeps the agent from opening new sessions, as a slow start does, until the returned function is called. */
  holdSessionOpening: () => () => void
  /** The first agent offers Claude Code's "Default" stand-in until the returned function is called. */
  offerDefaultStandIn: () => () => void
  /** Stops OpenAB and its agents, runs `whileDown`, then starts it again on the same address, as a runtime restart does, offering the runtime `jobs` given. */
  restartAgentHost: (whileDown?: () => Promise<void>, jobs?: string) => Promise<void>
  /** Freezes OpenAB and its agents, so its sockets stay open and nothing answers, runs `whileFrozen`, then lets them go on. */
  freezeAgentHost: (whileFrozen: () => Promise<void>) => Promise<void>
  /** Freezes the backend, so every request waits, runs `whileFrozen`, then lets it go on. */
  freezeBackend: (whileFrozen: () => Promise<void>) => Promise<void>
  /** The `state` of the newest Cloudflare authorization the app started. */
  cloudflareState: () => string
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

function cloudflareState(uri: string): string {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const [pending] = await client.db('nuphos_e2e').collection('cloudflare_oauth_pending')
      .find().sort({ expiresAt: -1 }).limit(1).toArray()
    await client.close()
    console.log(pending?._id ?? '')`

  return execFileSync('bun', ['-e', script, uri], { cwd: BACKEND_DIR, timeout: 10_000 })
    .toString()
    .trim()
}

/** The newest six-digit sign-in code the backend logged for this address. */
function signInCode(address: string): string | undefined {
  return readFileSync(logPath('backend'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(address) && line.includes('auth.email_otp.dev_code'))
    .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/.exec(line)?.[1])
    .findLast(Boolean)
}

export async function startStack(options: { botOnboarding?: boolean } = {}): Promise<Stack> {
  const [mongoPort, backendPort, runtimePort, secondRuntimePort, storagePort] = await freePorts(5)
  const mongoUri = startMongo(mongoPort)
  // Cloud computers too: only what a scenario puts in this instabox exists.
  const fakes = { ...(await startStorage(storagePort)), ...(await startInstaboxStub()) }

  await until('MongoDB to become primary', async () => initiateReplicaSet(mongoUri))
  const apiUrl = `http://127.0.0.1:${String(backendPort)}`
  const acpLog = join(artifacts, 'acp.jsonl')
  const holdOpening = join(artifacts, 'hold-opening')
  const standIn = join(artifacts, 'stand-in')
  // A file the fixture agent checks for, until the returned function removes it.
  const flag = (path: string) => () => {
    writeFileSync(path, '')

    return () => rmSync(path)
  }
  const offerDefaultStandIn = flag(standIn)
  const holdSessionOpening = flag(holdOpening)

  writeFileSync(acpLog, '')
  // One OpenAB and isolated home per runtime; each fixture entry logs its agent.
  const startAgentHost = (agent = 'first', port = runtimePort, jobs = '') => {
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
        ...(options.botOnboarding ? ['E2E_BOT_ONBOARDING = "true"'] : []),
        `E2E_ACP_LOG = ${JSON.stringify(acpLog)}`,
        `E2E_AGENT = ${JSON.stringify(agent)}`,
        `E2E_HOLD_OPENING = ${JSON.stringify(holdOpening)}`,
        `E2E_STAND_IN = ${JSON.stringify(standIn)}`,
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
        ...(jobs ? { OPENAB_RUNTIME_JOBS: jobs } : {}),
      },
    })
  }
  const agentHosts = [startAgentHost()]
  const restartAgentHost = async (whileDown?: () => Promise<void>, jobs = '') => {
    await stop(agentHosts.at(-1)!)
    await whileDown?.()
    agentHosts.push(startAgentHost('first', runtimePort, jobs))
    await until('OpenAB to listen again', async () =>
      fetch(`http://127.0.0.1:${String(runtimePort)}/`),
    )
  }
  const backend = spawn('backend', ['bun', 'run', 'src/index.ts'], {
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
      // Cloudflare is never reached: a scenario answers for it on this redirect.
      CLOUDFLARE_OAUTH_CLIENT_ID: 'e2e-cloudflare-client',
      CLOUDFLARE_OAUTH_CLIENT_SECRET: 'e2e-cloudflare-secret-not-a-production-credential',
      CLOUDFLARE_OAUTH_SETUP_REDIRECT: `${apiUrl}/cloudflare-app/setup`,
      // GitLab: a scenario serves the instance on this computer and answers its redirect.
      GITLAB_OAUTH_SETUP_REDIRECT: `${apiUrl}/gitlab-app/setup`,
      GITLAB_TOKEN_ENCRYPTION_KEY:
        '6c6f63616c2d6532652d6769746c61622d6b65792d6e6f742d70726f64756374',
      OUTBOUND_ALLOW_PRIVATE_HOSTS: 'true',
      SONARQUBE_BYOK_ENCRYPTION_KEY:
        '6c6f63616c2d6532652d736f6e6172717562652d6b65792d6e6f742d70726f64',
      // Where the agent reaches the backend's tools, as a runtime on this computer would.
      NUPHOS_BACKEND_URL: apiUrl,
      ...fakes,
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

  return {
    apiUrl,
    mongoUri,
    email,
    token,
    teamId,
    acpLog,
    signInCode,
    holdSessionOpening,
    offerDefaultStandIn,
    restartAgentHost,
    freezeAgentHost: (whileFrozen) => frozen(agentHosts.at(-1)!, whileFrozen),
    freezeBackend: (whileFrozen) => frozen(backend, whileFrozen),
    cloudflareState: () => cloudflareState(mongoUri),
  }
}
