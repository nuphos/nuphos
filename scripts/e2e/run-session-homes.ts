// An archived Task's home on someone's own computer is removed, and only that one (#4265).
// A stack of its own, since the sweep runs once a backend has started and restarting it here
// touches no other scenario. Everything is fictional: its own backend, database and computers.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

import { nuphosSessionHomeEnv } from '../../apps/runtime/image/session-home.mjs'

import { inDatabase } from './agent-sign-in-scenarios.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { startStack } from './stack.ts'
import { fixtureBundle } from './tunnel-scenarios.ts'

import type { Stack } from './stack.ts'

type Home = { sessionId: string; home: string }

/** A Task on the computer, with the home its agent made there, as the adapter makes it. */
function task(stack: Stack, ownerId: string, deviceId: string, computerHome: string): Home {
  const sessionId = `e2e-home-${randomUUID()}`
  const { HOME: home } = nuphosSessionHomeEnv(
    { NUPHOS_SESSION_ID: sessionId },
    { HOME: computerHome },
  ) as { HOME: string }

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
  const archive = async ({ sessionId }: Home) => {
    const archived = await owner('PATCH', `/agent/conversations/${sessionId}/archive`, {
      teamId: stack.teamId,
      archived: true,
    })

    must(archived.status < 300, `archiving to be taken, got ${String(archived.status)}`)
  }

  // The real `nuphos agent` host, whose session-homes job #4267 points at this HOME.
  const computer = await startSecondComputer(stack, 'E2E homes mini', {
    runtimeDir: fixtureBundle(stack, 'homes'),
  })
  const away = await startSecondComputer(stack, 'E2E homes away', {
    runtimeDir: fixtureBundle(stack, 'homes-away'),
  })
  const target = task(stack, ownerId, computer.deviceId, computer.home)
  const control = task(stack, ownerId, computer.deviceId, computer.home)
  const offline = task(stack, ownerId, away.deviceId, away.home)

  await away.stop()
  await archive(target)
  await archive(offline)
  // A job looking in another HOME answers "absent" and the backend took that as removed: each
  // home is there before the sweep, so only removing it can pass.
  for (const { home } of [target, control, offline]) must(existsSync(home), `${home} to exist`)

  // The sweep runs a minute after the backend starts; the computer redials it before then.
  await stack.restartBackend()
  await until(
    'the archived Task to be marked reclaimed',
    async () => reclaimedAt(stack, target),
    180_000,
  )

  must(!existsSync(target.home), "the archived Task's home to be removed from the computer")
  must(existsSync(control.home), "the other Task's home on that computer to be kept")
  must(!reclaimedAt(stack, control), 'the Task still in use not to be marked reclaimed')
  must(existsSync(offline.home), 'the home on the computer that is off to be kept')
  must(!reclaimedAt(stack, offline), 'a computer that is off not to be marked reclaimed')
  console.log('PASS an archived Task’s home is removed from its computer, and only that one')
  await computer.stop()
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
