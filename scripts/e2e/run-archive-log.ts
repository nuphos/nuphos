// #4954: every archive and restore names who did it and through what, read back from the
// conversation detail API. Real backend, MongoDB and OpenAB with the scripted agent.
// Run with: bun scripts/e2e/run-archive-log.ts
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'

type Change = { archived: boolean; source: string; via?: string; agentSessionId?: string }

const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
let failed = false

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)

  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failed = true
}

try {
  console.log(`Artifacts: ${artifacts}`)
  // A one-day idle setting; the idle conversation below is dated three days back.
  const stack = await startStack({
    backendStub: {
      preload: resolve(import.meta.dirname, 'cli-release-stub.ts'),
      env: { AGENT_AUTO_ARCHIVE_IDLE_DAYS: '1' },
    },
  })
  const as = client(stack.apiUrl, stack.token)
  const mongo = await new MongoClient(stack.mongoUri).connect()
  const conversations = mongo.db('nuphos_e2e').collection('agent_conversations')
  const messages = mongo.db('nuphos_e2e').collection('agent_messages')
  const teamId = stack.teamId
  const answered = async (id: string, marker: string) =>
    JSON.stringify(await messages.find({ sessionId: id }).toArray()).includes(`ACK ${marker}`)
  const say = async (id: string, text: string, marker: string) => {
    const sent = await as('POST', '/agent/chat', {
      id,
      teamId,
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    })

    must(sent.status === 200, `chat to start, got ${sent.text}`)
    await until(`${marker} to be answered`, async () => answered(id, marker), 90_000)
  }
  const fresh = async (name: string) => {
    const id = randomUUID()

    await say(id, `E2E_DELIVERY:${name}`, `E2E_DELIVERY:${name}`)

    return id
  }
  const call = (name: string, args: object) =>
    `E2E_CALL ${name} ${JSON.stringify({ label: name, ...args })}`
  const archive = async (id: string, archived: boolean) => {
    const moved = await as('PATCH', `/agent/conversations/${id}/archive`, { teamId, archived })

    must(moved.status === 200, `archive ${String(archived)} of ${id}, got ${moved.text}`)
  }
  const detail = async (id: string) => {
    const read = await as('GET', `/agent/conversations/${id}?teamId=${teamId}&messages=omit`)

    must(read.status === 200, `detail of ${id}, got ${read.text}`)

    return read.body as { archiveLog?: Change[]; archivedAt?: string }
  }
  const log = async (id: string) =>
    ((await detail(id)).archiveLog ?? []).map(({ archived, source, via, agentSessionId }) => ({
      archived,
      source,
      ...(via ? { via } : {}),
      ...(agentSessionId ? { agentSessionId } : {}),
    }))
  const report = async (name: string, id: string) => {
    const entries = (await detail(id)).archiveLog ?? []

    console.log(`\n${name} ${id}`)
    for (const entry of entries) console.log(`  ${JSON.stringify(entry)}`)
  }

  // 1. The owner archives and restores in the app.
  const own = await fresh('own')

  await archive(own, true)
  await archive(own, false)

  // 2. An agent starts two Tasks, archives one with archive_thread.
  const parent = await fresh('parent')
  const threads = () =>
    agentLog(stack)
      .filter((entry) => entry.event === 'called' && entry.name === 'create_thread')
      .map((entry) => /"threadId\\?":\\?"([0-9a-f-]{36})/.exec(JSON.stringify(entry.result))?.[1])

  await say(
    parent,
    [
      call('create_thread', { title: 'E2E child one', prompt: 'E2E_DELIVERY:child-one' }),
      call('create_thread', { title: 'E2E child two', prompt: 'E2E_DELIVERY:child-two' }),
      'E2E_DELIVERY:spawned',
    ].join('\n'),
    'E2E_DELIVERY:spawned',
  )
  const [one, two] = threads() as [string, string]

  must(Boolean(one && two), `two threads, got ${JSON.stringify(threads())}`)
  await until(
    'both threads to answer',
    async () =>
      (await answered(one, 'E2E_DELIVERY:child-one')) && answered(two, 'E2E_DELIVERY:child-two'),
  )
  await say(
    parent,
    `${call('archive_thread', { threadId: one })}\nE2E_DELIVERY:archived-one`,
    'E2E_DELIVERY:archived-one',
  )

  // 3. The owner archives and restores the parent: the Task open below it moves with it.
  await archive(parent, true)
  await archive(parent, false)
  // 4. Archived again, a turn brings the parent back. A turn restores only its own
  // conversation, so the Task below stays archived.
  await archive(parent, true)
  await say(parent, 'E2E_DELIVERY:back', 'E2E_DELIVERY:back')
  // 5. The parent's message to the archived Task brings that one back, naming the parent.
  await say(
    parent,
    `${call('send_message_to_thread', { threadId: one, prompt: 'E2E_DELIVERY:wake-one' })}\nE2E_DELIVERY:woke`,
    'E2E_DELIVERY:woke',
  )
  await until('the archived Task to come back', async () => !(await detail(one)).archivedAt)

  // 6. The idle sweep, a minute after the backend starts again.
  const idle = await fresh('idle')

  await conversations.updateOne(
    { sessionId: idle },
    { $set: { lastActiveAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
  )
  await stack.restartBackend()
  await until('the idle sweep', async () => Boolean((await detail(idle)).archivedAt), 150_000)

  check('owner archive and restore', await log(own), [
    { archived: true, source: 'user' },
    { archived: false, source: 'user' },
  ])
  check('archive_thread, then a turn from the parent', await log(one), [
    { archived: true, source: 'archive_thread', agentSessionId: parent },
    { archived: false, source: 'turn', agentSessionId: parent },
  ])
  check('owner archive and restore, then a turn restore', await log(parent), [
    { archived: true, source: 'user' },
    { archived: false, source: 'user' },
    { archived: true, source: 'user' },
    { archived: false, source: 'turn' },
  ])
  check('the cascade names the parent', await log(two), [
    { archived: true, source: 'user', via: parent },
    { archived: false, source: 'user', via: parent },
    { archived: true, source: 'user', via: parent },
  ])
  check('the idle sweep', await log(idle), [{ archived: true, source: 'auto_archive' }])

  console.log('\narchiveLog from GET /agent/conversations/:id')
  for (const [name, id] of Object.entries({ own, parent, one, two, idle })) await report(name, id)
  await mongo.close()
} catch (err) {
  console.error(err)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
