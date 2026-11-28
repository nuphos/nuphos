// A Trigger that fires while its Task is being moved to another agent waits for the move and
// runs; it is not failed with "This conversation is being moved" (#5376). The fire and the move
// race, so the move is sent at a growing delay after each fire until one lands inside the turn.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { inDatabase } from './agent-sign-in-scenarios.ts'
import { client, must } from './binding-access-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, logPath, stopAll, until } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'
import { openRow } from './ui.ts'

import type { Desktop } from './desktop.ts'

const MARKER = 'E2E_DELIVERY:move-trigger'
const MOVING = 'This conversation is being moved'
const TRIES = 20
let failed = false
let desktop: Desktop | undefined

const check = (label: string, ok: boolean, detail = '') => {
  console.log([ok ? 'PASS' : 'FAIL', label, detail].filter(Boolean).join(' '))
  if (!ok) failed = true
}

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ redis: true })
  const owner = client(stack.apiUrl, stack.token)
  const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
  const ownerId = me.user?.id ?? me.id ?? ''
  const { runtimes } = (await owner('GET', `/teams/${stack.teamId}/agent-runtimes`)).body as {
    runtimes: { id: string; label: string }[]
  }
  const ids = ['E2E fixture agent', 'E2E second agent'].map(
    (label) => runtimes.find((runtime) => runtime.label === label)?.id ?? '',
  )
  const sessionId = `e2e-move-trigger-${randomUUID()}`

  inDatabase(
    stack.mongoUri,
    `const now = new Date()
    await db.collection('agent_conversations').insertOne({ sessionId: process.argv[2],
      teamId: process.argv[3], userId: process.argv[4], runtimeId: process.argv[5],
      agentRuntime: 'claude-code', title: 'E2E move Trigger', messageCount: 0,
      createdAt: now, updatedAt: now, lastActiveAt: now })`,
    sessionId,
    stack.teamId,
    ownerId,
    ids[0]!,
  )
  const created = await owner('POST', '/agent/triggers', {
    teamId: stack.teamId,
    targetSessionId: sessionId,
    name: 'E2E move Trigger',
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: `Quick check ${MARKER}`,
  })

  must(created.status < 300, `the Trigger to be created, got ${String(created.status)}`)
  const triggerId = (created.body as { id: string }).id
  const backendLog = () => readFileSync(logPath('backend'), 'utf8')
  const answered = () => agentEvents(stack).filter((event) => event === `finish ${MARKER}`).length
  let fires = 0
  let moving = false

  for (let i = 0; i < TRIES && !moving; i++) {
    const before = answered()
    const fired = await owner(
      'POST',
      `/agent/triggers/${triggerId}/test-fire?teamId=${stack.teamId}`,
    )

    must(fired.status < 300, `the Trigger to fire, got ${String(fired.status)}`)
    fires++
    await new Promise((done) => setTimeout(done, i * 40))
    const moved = await owner('POST', `/agent/conversations/${sessionId}/runtime`, {
      runtimeId: ids[(i + 1) % 2],
      teamId: stack.teamId,
    })

    console.log(`try ${String(i)}: move after ${String(i * 40)}ms answered ${String(moved.status)}`)
    moving = backendLog().includes(MOVING)
    // The fire runs, or fails, before the next try.
    await until(
      'the fire to settle',
      async () => answered() > before || backendLog().includes(MOVING),
      30_000,
    ).catch(() => {})
    moving ||= backendLog().includes(MOVING)
  }
  console.log(`fires: ${String(fires)}, the move cut a turn: ${String(moving)}`)
  must(moving, `a move to land inside a Trigger turn in ${String(TRIES)} tries`)
  await until('every fire to be answered', async () => answered() >= fires, 30_000).catch(() => {})

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const scenario of signInScenarios) await scenario.run(desktop.page, stack)
  await desktop.page.getByRole('tab', { name: 'Tasks' }).click()
  await openRow(desktop.page, 'E2E move Trigger')
  await desktop.page.waitForTimeout(3_000)
  await desktop.page.screenshot({ path: join(artifacts, 'move-trigger-end.png') })

  const replies = inDatabase(
    stack.mongoUri,
    `const rows = await db.collection('agent_messages').find({ sessionId: process.argv[2], role: 'assistant' }).toArray()
    console.log(JSON.stringify(rows))`,
    sessionId,
  )

  check(
    'no fire is failed as a move',
    !replies.includes(MOVING),
    `answered ${String(answered())}/${String(fires)}`,
  )
  check('every fire is answered', answered() >= fires)
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
