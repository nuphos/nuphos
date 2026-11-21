// An archived Task's home on its computer goes with its Triggers, and only that Task's (#4265, #4354).
// A stack of its own: restarting its backend for the sweep touches no other scenario.
// Everything is fictional: its own backend, database and computers.
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { nuphosSessionHomeEnv } from '../../apps/runtime/image/session-home.mjs'

import { inDatabase } from './agent-sign-in-scenarios.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, logPath, stopAll, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { startStack } from './stack.ts'
import { fixtureBundle } from './tunnel-scenarios.ts'

import type { Stack } from './stack.ts'

type Home = { sessionId: string; home: string }

/** The home a Task's agent makes on the computer, as the adapter makes it, in each generation. */
const homeOf = (sessionId: string, computerHome: string, epoch = '0') =>
  (
    nuphosSessionHomeEnv(
      { NUPHOS_SESSION_ID: sessionId, NUPHOS_SESSION_HOME_EPOCH: epoch },
      { HOME: computerHome },
    ) as { HOME: string }
  ).HOME

/** A Task on the computer, with the home its agent made there. */
function task(stack: Stack, ownerId: string, deviceId: string, computerHome: string): Home {
  const sessionId = `e2e-home-${randomUUID()}`
  const home = homeOf(sessionId, computerHome)

  inDatabase(
    stack.mongoUri,
    `const now = new Date()
    await db.collection('agent_conversations').insertOne({ sessionId: process.argv[2],
      teamId: process.argv[3], userId: process.argv[4], runtimeId: process.argv[5],
      agentRuntime: 'claude-code', title: 'E2E session home', messageCount: 0,
      createdAt: now, updatedAt: now, lastActiveAt: now })`,
    sessionId,
    stack.teamId,
    ownerId,
    `local_${ownerId}_${deviceId}`,
  )

  return { sessionId, home }
}

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

function reclaimedAt(stack: Stack, { sessionId }: Home): string {
  return inDatabase(
    stack.mongoUri,
    `const row = await db.collection('agent_conversations').findOne({ sessionId: process.argv[2] })
    console.log(row?.sessionHomeReclaimedAt?.toISOString() ?? '')`,
    sessionId,
  )
}

let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const owner = client(stack.apiUrl, stack.token)
  const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const ownerId = me.user?.id ?? me.id ?? ''
  const archive = async ({ sessionId }: Home, archived = true) => {
    const response = await owner('PATCH', `/agent/conversations/${sessionId}/archive`, {
      teamId: stack.teamId,
      archived,
    })

    must(response.status < 300, `archiving to be taken, got ${String(response.status)}`)
  }
  const trigger = async ({ sessionId }: Home, enabled: boolean) => {
    const created = await owner('POST', '/agent/triggers', {
      teamId: stack.teamId,
      targetSessionId: sessionId,
      name: `E2E ${enabled ? 'enabled' : 'disabled'} Trigger`,
      triggerType: 'cron',
      cronExpression: '0 * * * *',
      messageTemplate: 'E2E check',
      enabled,
    })

    must(created.status < 300, `the Trigger to be created, got ${String(created.status)}`)

    return (created.body as { id: string }).id
  }
  const triggersOf = async ({ sessionId }: Home) => {
    const listed = await owner(
      'GET',
      `/agent/triggers?teamId=${stack.teamId}&targetSessionId=${sessionId}`,
    )

    return (listed.body as { id: string }[]).map(({ id }) => id).sort()
  }

  // The real `nuphos agent` host, whose session-homes job #4267 points at this HOME.
  const computer = await startSecondComputer(stack, 'E2E homes mini', {
    runtimeDir: fixtureBundle(stack, 'homes'),
    prepare: signedIn(ownerId),
  })
  const away = await startSecondComputer(stack, 'E2E homes away', {
    runtimeDir: fixtureBundle(stack, 'homes-away'),
    prepare: signedIn(ownerId),
  })
  const online = (label: string, times = 1) =>
    until(
      `${label} to have Claude Code online`,
      async () =>
        readFileSync(logPath(`computer-${label}`), 'utf8').split('Claude Code: online').length >
        times,
    )

  // Signed out, a computer gives the backend no control channel and nothing is reclaimed.
  for (const label of ['E2E homes mini', 'E2E homes away']) await online(label)
  const target = task(stack, ownerId, computer.deviceId, computer.home)
  const control = task(stack, ownerId, computer.deviceId, computer.home)
  const offline = task(stack, ownerId, away.deviceId, away.home)
  const controlTriggers = [await trigger(control, true)]

  await trigger(target, true)
  await trigger(target, false)
  must(
    (await triggersOf(target)).length === 2,
    'the Task to have an enabled and a disabled Trigger',
  )
  await away.stop()
  // A job looking in another HOME answers "absent" and the backend took that as removed: each
  // home is there first, so only removing it can pass.
  for (const { home } of [target, control, offline]) must(existsSync(home), `${home} to exist`)
  await archive(target)
  await archive(offline)

  // Archiving removes the Task's Triggers and, its computer online, its home at once.
  must((await triggersOf(target)).length === 0, "the archived Task's Triggers to be deleted")
  must(
    JSON.stringify(await triggersOf(control)) === JSON.stringify(controlTriggers),
    "the other Task's Trigger to be kept",
  )
  must(!existsSync(target.home), "the archived Task's home to be removed from the computer")
  must(Boolean(reclaimedAt(stack, target)), 'the archived Task to be marked reclaimed')
  must(existsSync(control.home), "the other Task's home on that computer to be kept")
  must(!reclaimedAt(stack, control), 'the Task still in use not to be marked reclaimed')
  must(existsSync(offline.home), 'the home on the computer that is off to be kept')
  must(!reclaimedAt(stack, offline), 'a computer that is off not to be marked reclaimed')

  // Restored, each Task works in a new home generation, made here as its next turn makes it;
  // the one on the computer that is off is restored before its late reclaim arrives.
  await archive(target, false)
  await archive(offline, false)
  const restored = homeOf(target.sessionId, computer.home, '1')
  const restoredAway = homeOf(offline.sessionId, away.home, '1')
  const kept = [await trigger(target, true)]

  must(restored !== target.home, 'the restored Task to get a new home')
  for (const home of [restored, restoredAway]) mkdirSync(home, { recursive: true })

  // The computer that was off comes back; the sweep, a minute after the backend starts,
  // reclaims the home archived while it was off.
  await away.start()
  await online('E2E homes away', 2)
  await stack.restartBackend()
  await until(
    'the home archived while its computer was off to be reclaimed',
    async () => reclaimedAt(stack, offline),
    180_000,
  )
  must(!existsSync(offline.home), 'the home archived while its computer was off to be removed')
  must(existsSync(restoredAway), 'a late reclaim to leave the home restored meanwhile')
  must(existsSync(restored), "the restored Task's new home to be kept by the sweep")
  must(
    JSON.stringify(await triggersOf(target)) === JSON.stringify(kept),
    'a Trigger made after restoring to be kept by the sweep',
  )
  must(existsSync(control.home), "the other Task's home to be kept by the sweep")
  console.log('PASS an archived Task’s home and Triggers go, and only that Task’s')
  console.log('PASS a restored Task keeps its new home and Triggers through the sweep')
  console.log('PASS archive, restore, then a late reclaim removes only the archived generation')
  await computer.stop()
  await away.stop()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
