// `node --experimental-strip-types scripts/e2e/run-box-opencode.ts`: a new account on a phone, with
// no computer of its own, makes a Bot without picking a runtime, and it answers through OpenCode's
// free models on the account's free Box. OPENCODE names an OpenCode CLI, RUNTIME_DIR a local runtime.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { client, must } from './binding-access-scenarios.ts'
import { instaboxExec } from './instabox-stub.ts'
import { artifacts, spawn, stopAll, until } from './processes.ts'
import { DESKTOP_DIR } from './second-computer.ts'
import { startStack } from './stack.ts'

type Json = Record<string, any>

const opencode = process.env.OPENCODE ?? 'opencode'
const runtimeDir =
  process.env.RUNTIME_DIR ?? join(DESKTOP_DIR, 'build', 'local-runtime', 'linux-x64')
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ boxes: true, freeBox: true })
  const host = join(DESKTOP_DIR, 'build', 'e2e-host.mjs')

  execFileSync(
    'bun',
    [
      'build',
      'electron/main/local-runtime/cli-host.ts',
      '--target=node',
      '--format=esm',
      '--external',
      '@napi-rs/keyring',
      `--outfile=${host}`,
    ],
    { cwd: DESKTOP_DIR, stdio: 'ignore' },
  )
  // The command that starts a Box's host starts it here, with the token it was given; the
  // stack's own accounts get free Boxes too, so each has a home of its own.
  let boxes = 0

  const startHost = (token: string, apiUrl = stack.apiUrl) => {
    const name = `box-${String(++boxes)}`
    const home = join(artifacts, name)

    mkdirSync(join(home, '.nuphos-agent'), { recursive: true })
    spawn(name, ['node', host], {
      env: {
        HOME: home,
        PATH: `${dirname(opencode)}:${process.env.PATH ?? ''}`,
        NUPHOS_AGENT_HOME: join(home, '.nuphos-agent'),
        NUPHOS_LOCAL_RUNTIME_DIR: runtimeDir,
        NUPHOS_API_URL: apiUrl,
        NUPHOS_JOIN_TOKEN: token,
      },
    })
  }

  instaboxExec.onRun = (_cmd, envs) => {
    if (envs.NUPHOS_JOIN_TOKEN) startHost(envs.NUPHOS_JOIN_TOKEN, envs.NUPHOS_API_URL)

    return 0
  }
  // Signed in and given a workspace as the phone app does it.
  const email = `e2e-box-opencode-${String(Date.now())}@example.com`
  const anonymous = client(stack.apiUrl, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until('the sign-in code to be logged', async () => stack.signInCode(email))
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })
  const as = client(stack.apiUrl, (verified.body as { token: string }).token)
  const team = await as('POST', '/teams', { name: 'New user' })

  must(team.status < 300, `the workspace to be made, got ${team.text}`)
  const teamId = ((team.body as Json).team?.id ?? (team.body as Json).id) as string
  // The Box joins once instabox has answered the idle-pause change, about a minute here.
  const runtimes = async () =>
    ((await as('GET', `/teams/${teamId}/agent-runtimes`)).body as Json).runtimes as Json[]

  await until(
    'OpenCode on the free Box to be ready',
    async () =>
      (await runtimes()).some((r) => r.provider === 'opencode' && r.local?.box && r.local.online),
    4 * 60_000,
  )
  console.log(
    (await runtimes())
      .map((r) => `${String(r.provider)} box=${String(Boolean(r.local?.box))} ${String(r.id)}`)
      .join('\n'),
  )
  const bot = await as('POST', `/agent/bots?teamId=${teamId}`, { title: 'First Bot' })

  must(bot.status === 201, `the Bot to be made, got ${bot.text}`)
  const botId = (bot.body as Json).sessionId as string
  const marker = `BOX-OPENCODE-${String(Date.now())}`
  const sent = await fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${(verified.body as { token: string }).token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: botId,
      teamId,
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          parts: [
            { type: 'text', text: `Reply with exactly this word and nothing else: ${marker}` },
          ],
        },
      ],
    }),
  })

  must(sent.status === 200, `the message to be taken, got ${String(sent.status)}`)
  await sent.body?.cancel()
  const conversation = async () =>
    (await as('GET', `/agent/conversations/${botId}?teamId=${teamId}`)).body as Json

  // Once in the message sent, once more in OpenCode's answer.
  await until(
    'the Bot to answer',
    async () => JSON.stringify((await conversation()).messages).split(marker).length > 2,
    6 * 60_000,
  )
  const pinned = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `const { MongoClient } = await import('mongodb')
const m = await new MongoClient(process.argv[1]).connect()
const row = await m.db('nuphos_e2e').collection('agent_conversations').findOne({ sessionId: process.argv[2] })
console.log(JSON.stringify({ agentRuntime: row?.agentRuntime, runtimeId: row?.runtimeId }))
await m.close()`,
        stack.mongoUri,
        botId,
      ],
      { cwd: join(DESKTOP_DIR, '..', 'backend'), encoding: 'utf8' },
    ),
  ) as Json

  console.log(`runtime ${String(pinned.agentRuntime)} on ${String(pinned.runtimeId)}`)
  must(
    pinned.agentRuntime === 'opencode' && String(pinned.runtimeId).endsWith('_opencode'),
    'the Bot to run on OpenCode on the Box',
  )
  console.log('PASS a phone-only account’s first Bot answers through OpenCode on its free Box')
} catch (error) {
  failed = true
  console.error(error)
  console.error(`FAIL: logs are in ${artifacts}`)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
