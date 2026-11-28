// #5277: a Bot whose chat sat idle past the auto-archive window still opens from Bots.
// Real backend, MongoDB, OpenAB with the scripted agent, and the Desktop app.
// Run with: bun scripts/e2e/run-idle-bot-chat.ts
import { resolve } from 'node:path'

import { createBotScenario } from './bot-chat-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { recordScreencast } from './screencast.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const desktop = await startDesktop(stack.apiUrl)
  const { page } = desktop

  for (const step of [...signInScenarios, createBotScenario]) await step.run(page, stack)

  const mongo = await new MongoClient(stack.mongoUri).connect()
  const conversations = mongo.db('nuphos_e2e').collection('agent_conversations')
  const bot = await conversations.findOne({ avatar: { $exists: true }, kind: { $exists: false } })
  const chat = await conversations.findOne({ kind: 'channel', agentSessionIds: bot?.sessionId })

  if (!bot || !chat) throw new Error('no Bot with a chat')
  // Both idle for eight days, past the default seven-day window, with the chat
  // filed away alone, as the idle sweep used to leave it. A Task idle as long
  // shows when the sweep has run.
  const idle = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  const task = `e2e-idle-task-${Date.now()}`

  await conversations.updateMany(
    { sessionId: { $in: [bot.sessionId, chat.sessionId] } },
    { $set: { lastActiveAt: idle }, $unset: { archiveRestoredAt: '' } },
  )
  await conversations.updateOne({ sessionId: chat.sessionId }, { $set: { archivedAt: idle } })
  await conversations.insertOne({
    sessionId: task,
    userId: bot.userId,
    teamId: bot.teamId,
    title: 'Idle Task',
    firstMessage: '',
    messageCount: 1,
    createdAt: idle,
    lastActiveAt: idle,
  })
  // Start brings back the stranded chat; the sweep runs a minute later.
  await stack.restartBackend()
  await until(
    'the idle sweep',
    async () => Boolean((await conversations.findOne({ sessionId: task }))?.archivedAt),
    180_000,
  )
  const state = async () => {
    const [b, c] = await Promise.all([
      conversations.findOne({ sessionId: bot.sessionId }),
      conversations.findOne({ sessionId: chat.sessionId }),
    ])

    return { botArchived: Boolean(b?.archivedAt), chatArchived: Boolean(c?.archivedAt) }
  }

  console.log(`after the sweep: ${JSON.stringify(await state())}`)

  // Back to Bots, as someone coming back a week later would, and open the Bot.
  await page.reload()
  await page.getByRole('tab', { name: 'Bots' }).click()
  const row = page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()

  await row.waitFor()
  await page.screenshot({ path: `${artifacts}/idle-bot-before-click.png` })
  const opened = await recordScreencast(page, 'idle-bot-click', async () => {
    await row.click()
    // The bug: the row leaves Bots as if the Bot were archived, and comes back later.
    const left = await row.waitFor({ state: 'hidden', timeout: 4_000 }).then(
      () => true,
      () => false,
    )

    return !left && (await page.getByText('POSTED E2E_DELIVERY:bot').first().isVisible())
  })

  await page.screenshot({ path: `${artifacts}/idle-bot-after-click.png` })
  console.log(`after the click: ${JSON.stringify({ ...(await state()), opened })}`)
  console.log(`${opened ? 'PASS' : 'FAIL'} the Bot's chat opens from Bots`)
  if (!opened) failed = true
  await mongo.close()
  await desktop.close(failed)
} catch (err) {
  console.error(err)
  failed = true
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)
