// A computer with two Claude Codes, the second signed out: a connection to the first wakes only
// the first's Bots, not the second's, which can only fail again. All fictional.
// Run with: bun scripts/e2e/run-signed-out-wake.ts
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { inDatabase } from './agent-sign-in-scenarios.ts'
import { backendLog } from './backend-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { startStack } from './stack.ts'
import { fixtureBundle } from './tunnel-scenarios.ts'

const BOTS = 3
const count = (from: number, event: string) =>
  backendLog(from).filter((line) => line.includes(`"event":"${event}"`)).length
const failedTurns = (from: number) => count(from, 'agent.channel.turn_failed')

let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const owner = client(stack.apiUrl, stack.token)
  const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const ownerId = me.user?.id ?? me.id ?? ''
  // Its first Claude Code signed in; one added later is not.
  const computer = await startSecondComputer(stack, 'E2E two Claude Codes', {
    runtimeDir: fixtureBundle(stack, 'signed-out-wake'),
    prepare: (home, agentHome) => {
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
    },
  })
  const first = `local_${ownerId}_${computer.deviceId}`
  const added = await owner('POST', `/agent/devices/${computer.deviceId}/agents`, {
    teamId: stack.teamId,
    provider: 'claude-code',
  })

  must(added.status === 201, `a second Claude Code, got ${String(added.status)} ${added.text}`)
  const second = (added.body as { runtimeId: string }).runtimeId

  // Its host takes it up on its next status report.
  await new Promise((settle) => setTimeout(settle, 5_000))
  const channelWith = async (title: string, runtimeId: string, bots: number) => {
    const { sessionId } = (await owner('POST', '/agent/channels', { teamId: stack.teamId, title }))
      .body as { sessionId: string }

    for (let i = 0; i < bots; i++) {
      const bot = await owner('POST', '/agent/bots', {
        teamId: stack.teamId,
        title: `${title} Bot ${String(i)}`,
        agentRuntime: 'claude-code',
        runtimeId,
      })

      must(bot.status === 201, `a Bot, got ${String(bot.status)} ${bot.text}`)
      const joined = await owner('POST', `/agent/conversations/${sessionId}/agents`, {
        teamId: stack.teamId,
        sessionId: (bot.body as { sessionId: string }).sessionId,
      })

      must(joined.status < 300, `the Bot to join, got ${String(joined.status)} ${joined.text}`)
    }

    return sessionId
  }
  const ops = await channelWith('Ops', second, BOTS)
  const other = await channelWith('Other', first, 1)
  const post = (channelId: string, text: string) =>
    owner('POST', `/agent/conversations/${channelId}/channel-messages`, {
      teamId: stack.teamId,
      text,
    })

  // As Bots that answered here before their Claude Code was signed out: each has a place.
  inDatabase(
    stack.mongoUri,
    `const id = process.argv[2]
    const row = await db.collection('agent_conversations').findOne({ sessionId: id })
    const set = Object.fromEntries(row.agentSessionIds.map((s) => ['agentReadIndex.' + s, -1]))
    await db.collection('agent_conversations').updateOne({ sessionId: id }, { $set: set })`,
    ops,
  )
  let mark = backendLog().length

  await post(ops, 'Status?')
  await until('each signed-out Bot to fail once', async () => failedTurns(mark) === BOTS)

  // Over a fresh backend each time, so the first Claude Code gets new connections.
  for (const round of [1, 2]) {
    mark = backendLog().length
    await stack.restartBackend()
    // The computer coming back wakes every agent on it, once.
    await until('the computer to wake its Bots', async () => failedTurns(mark) >= BOTS)
    mark = backendLog().length
    await post(other, `Hello ${String(round)}`)
    await until(
      'the Bot on the first Claude Code to answer',
      async () => count(mark, 'agent.chat.first_output') > 0,
    )
    await new Promise((settle) => setTimeout(settle, 10_000))
    must(
      count(mark, 'agent.openab_runtime.connected') > 0,
      'the first Claude Code to get a new connection',
    )
    must(
      failedTurns(mark) === 0,
      `no signed-out Bot to be woken by it, got ${String(failedTurns(mark))} failed turns`,
    )
  }
  console.log('PASS a connection wakes only the agents on its own runtime')
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
