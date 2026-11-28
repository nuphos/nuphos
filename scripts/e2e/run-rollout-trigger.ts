// A Trigger turn on a computer survives a rolling deploy of the replica holding its tunnel (#5370):
// the turn on another replica is answered, neither lost nor failed as a lost computer. With
// E2E_SLOW_MS and E2E_CUT_MS the restart cuts its state check; without, its opening session.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { connect, createServer } from 'node:net'

import { agentEvents, agentLog } from './agent-log.ts'
import { inDatabase } from './agent-sign-in-scenarios.ts'
import { client, must } from './binding-access-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, freePorts, logPath, spawn, stopAll, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'
import { fixtureBundle } from './tunnel-scenarios.ts'
import { openRow } from './ui.ts'

import type { Desktop } from './desktop.ts'
import type { Socket } from 'node:net'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const MARKER = 'E2E_DELIVERY:rollout-trigger'
const DISCONNECTED = 'The computer running this agent disconnected'
let failed = false
let desktop: Desktop | undefined

const check = (label: string, ok: boolean, detail = '') => {
  console.log([ok ? 'PASS' : 'FAIL', label, detail].filter(Boolean).join(' '))
  if (!ok) failed = true
}
const read = (path: string) => readFileSync(path, 'utf8')

/** Claude Code installed and signed in on the computer, as fixture-claude.mjs's sign-in leaves it. */
const signedIn = (ownerId: string) => (home: string, agentHome: string) => {
  const bin = join(home, '.local', 'bin')
  const config = join(agentHome, 'users', ownerId, 'claude-home')

  mkdirSync(bin, { recursive: true })
  copyFileSync(join(import.meta.dirname, 'fixture-claude.mjs'), join(bin, 'claude'))
  chmodSync(join(bin, 'claude'), 0o755)
  mkdirSync(config, { recursive: true })
  writeFileSync(
    join(config, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'e2e', subscriptionType: 'max' } }),
  )
}

// The load balancer in front of the replicas: new connections go to `target`, and every chunk
// waits `target.delayMs` each way, in order, as on a slow network.
async function balancer(port: number) {
  const target = { port, delayMs: 0 }
  const relay = (from: Socket, to: Socket) => {
    let due = 0

    from.on('data', (chunk) => {
      due = Math.max(Date.now() + target.delayMs, due)
      setTimeout(() => to.write(chunk), due - Date.now())
    })
    from.on('end', () => setTimeout(() => to.end(), Math.max(0, due - Date.now())))
  }
  const server = createServer((socket) => {
    const upstream = connect(target.port, '127.0.0.1')

    relay(socket, upstream)
    relay(upstream, socket)
    socket.on('error', () => upstream.destroy())
    upstream.on('error', () => socket.destroy())
  })

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))

  return {
    url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`,
    target,
  }
}

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ redis: true })
  const owner = client(stack.apiUrl, stack.token)
  const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const ownerId = me.user?.id ?? me.id ?? ''

  // A holds the computer's tunnel and is rolled away; B runs the Trigger's turn; D serves the app.
  const replica = async (name: string) => {
    const [port] = await freePorts(1)
    const url = `http://127.0.0.1:${String(port)}`
    const child = spawn(name, ['bun', 'run', 'src/index.ts'], {
      cwd: BACKEND_DIR,
      env: { ...stack.backendEnv, PORT: String(port), NUPHOS_BACKEND_URL: url },
    })

    await until(`${name} to be ready`, async () => (await fetch(`${url}/health/ready`)).ok)

    return { url, child }
  }
  const b = await replica('backend-b')
  const bUrl = b.url
  const d = await replica('backend-d')

  // A is the stack's own backend; the computer dials it through the balancer, so A holds its tunnel.
  const aPort = Number(new URL(stack.apiUrl).port)
  const lb = await balancer(aPort)
  const release = join(artifacts, 'rollout-release')

  // While this file exists the agent's session does not open, as a real agent's slow start.
  const holdOpening = join(artifacts, 'rollout-never')

  rmSync(release, { force: true })
  const computer = await startSecondComputer(stack, 'E2E rollout mini', {
    apiUrl: lb.url,
    runtimeDir: fixtureBundle(stack, 'rollout', release),
    prepare: signedIn(ownerId),
  })
  const sessionId = `e2e-rollout-${randomUUID()}`

  inDatabase(
    stack.mongoUri,
    `const now = new Date()
    await db.collection('agent_conversations').insertOne({ sessionId: process.argv[2],
      teamId: process.argv[3], userId: process.argv[4], runtimeId: process.argv[5],
      agentRuntime: 'claude-code', title: 'E2E rollout Trigger', messageCount: 0,
      createdAt: now, updatedAt: now, lastActiveAt: now })`,
    sessionId,
    stack.teamId,
    ownerId,
    `local_${ownerId}_${computer.deviceId}`,
  )

  desktop = await startDesktop(d.url)
  desktop.page.setDefaultTimeout(30_000)
  // The app signs in through D, so its code is in D's log.
  const viaB = {
    ...stack,
    signInCode: (email: string) =>
      read(logPath('backend-d'))
        .split('\n')
        .filter((line) => line.includes(email) && line.includes('auth.email_otp.dev_code'))
        .map((line) => /"sign_in_code"\s*:\s*"(\d{6})"/u.exec(line)?.[1])
        .findLast(Boolean),
  }

  for (const scenario of signInScenarios) await scenario.run(desktop.page, viaB)

  const onB = client(bUrl, stack.token)
  const created = await onB('POST', '/agent/triggers', {
    teamId: stack.teamId,
    targetSessionId: sessionId,
    name: 'E2E rollout Trigger',
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: `Long check E2E_WAIT_RELEASE ${MARKER}`,
  })

  must(created.status < 300, `the Trigger to be created, got ${String(created.status)}`)
  const triggerId = (created.body as { id: string }).id
  // Two windows a restart can cut a turn in: before the runtime accepts the prompt (a slow
  // tunnel stretches it), or after, while the agent's session is still opening (held open).
  const slowMs = Number(process.env.E2E_SLOW_MS ?? 0)
  const connected = () => read(logPath('backend-b')).split('agent.openab_runtime.connected').length
  const connectedBefore = connected()
  const openingsBefore = agentLog(stack).filter((entry) => entry.event === 'opening').length
  // A's replacement is up before the deploy, as Kubernetes starts it first.
  const c = await replica('backend-c')

  await desktop.page.getByRole('tab', { name: 'Tasks' }).click()
  await openRow(desktop.page, 'E2E rollout Trigger')
  if (slowMs) lb.target.delayMs = slowMs
  else writeFileSync(holdOpening, '')
  const fired = await onB('POST', `/agent/triggers/${triggerId}/test-fire?teamId=${stack.teamId}`)

  must(fired.status < 300, `the Trigger to fire, got ${String(fired.status)}`)
  if (slowMs)
    await until("the turn's runtime connection to open", async () => connected() > connectedBefore)
  else
    await until(
      'the agent session to be opening on the computer',
      async () =>
        agentLog(stack).filter((entry) => entry.event === 'opening').length > openingsBefore,
    )
  await desktop.page.screenshot({ path: join(artifacts, 'rollout-1-running.png') })
  await new Promise((done) => setTimeout(done, Number(process.env.E2E_CUT_MS ?? 0)))

  // The rolling deploy: A is sent SIGTERM and the balancer sends new dials to C.
  const aLog = logPath('backend')
  const aPid = Number(
    /pid=(\d+)/u.exec(execSync(`ss -ltnpH 'sport = :${String(aPort)}'`, { encoding: 'utf8' }))?.[1],
  )
  const aGroup = Number(execSync(`ps -o pgid= -p ${String(aPid)}`, { encoding: 'utf8' }).trim())

  process.kill(-aGroup, 'SIGTERM')
  lb.target.port = Number(new URL(c.url).port)
  await until('A to close the tunnel for restart', async () => /"code":1012/u.test(read(aLog)))
  lb.target.delayMs = 0
  rmSync(holdOpening, { force: true })
  await until('the computer to redial', async () =>
    read(logPath('backend-c')).includes('tunnel_opened'),
  )
  await until('A to exit', async () => {
    try {
      process.kill(aPid, 0)

      return false
    } catch {
      return true
    }
  })
  await desktop.page.waitForTimeout(3_000)
  await desktop.page.screenshot({ path: join(artifacts, 'rollout-2-after-roll.png') })

  writeFileSync(release, '')
  await until(
    'the agent to finish',
    async () => agentEvents(stack).includes(`finish ${MARKER}`),
    30_000,
  ).catch(() => {})
  await desktop.page.waitForTimeout(3_000)
  await desktop.page.screenshot({ path: join(artifacts, 'rollout-3-end.png') })

  const bLog = read(logPath('backend-b'))
  const replies = inDatabase(
    stack.mongoUri,
    `const rows = await db.collection('agent_messages').find({ sessionId: process.argv[2], role: 'assistant' }).toArray()
    console.log(JSON.stringify(rows))`,
    sessionId,
  )

  console.log(
    `agent events: ${agentEvents(stack)
      .filter((e) => e.includes(MARKER))
      .join(' | ')}`,
  )
  check(
    'the turn on B is not failed as a lost computer',
    !bLog.includes(DISCONNECTED) && !replies.includes(DISCONNECTED),
  )
  check('the Trigger turn is answered', replies.includes(`ACK ${MARKER}`))
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
