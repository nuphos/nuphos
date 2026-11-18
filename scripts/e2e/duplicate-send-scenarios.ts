// Repro only (not for merge): a message sent once must show once in a long conversation
// whose stored history holds messages with no parts (the trigger #1413 described), when a
// second copy is queued within two seconds and then taken back off the queue.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { client } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const EARLIER = 260
const PROMPT = 'Repeat check E2E_HOLD E2E_DELIVERY:dup-1'

/** Stores a long history in which every other assistant message has no parts at all. */
function storeHistory(mongoUri: string, sessionId: string, userId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, sessionId, userId, count] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const messages = db.collection('agent_messages')
    const stored = await messages.countDocuments({ sessionId, userId })
    const now = new Date()
    await messages.insertMany(Array.from({ length: Number(count) }, (_, n) => ({
      sessionId, userId, messageId: 'dup-filler-' + n, index: stored + n,
      role: n % 2 === 0 ? 'user' : 'assistant',
      parts: n % 4 === 1 ? [] : [{ type: 'text', text: 'Dup filler ' + String(n).padStart(3, '0') }],
      createdAt: now, updatedAt: now,
    })))
    await db.collection('agent_conversations').updateOne({ sessionId, userId }, {
      $set: { messageCount: stored + Number(count), transcriptUpdatedAt: now, lastActiveAt: now },
    })
    await client.close()`

  execFileSync('bun', ['-e', script, mongoUri, sessionId, userId, String(EARLIER)], {
    cwd: BACKEND_DIR,
    timeout: 20_000,
  })
}

async function sessionFor(stack: Stack, marker: string) {
  const { conversations } = (
    await client(stack.apiUrl, stack.token)(
      'GET',
      `/agent/conversations?teamId=${stack.teamId}&search=${encodeURIComponent(marker)}`,
    )
  ).body as { conversations: { sessionId: string; userId: string }[] }
  const session = conversations[0]

  if (!session) throw new Error(`No conversation found for ${marker}`)

  return session
}

const copies = (page: Page) =>
  page.locator('.user-message-bubble').filter({ hasText: PROMPT }).count()

export const duplicateSendScenarios: Scenario[] = [
  {
    name: 'REPRO: a message sent once shows once over a history with empty messages, after a queued copy is taken back',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Open the dup history E2E_DELIVERY:dup-0')
      await page.getByText('ACK E2E_DELIVERY:dup-0').waitFor()
      const session = await sessionFor(stack, 'E2E_DELIVERY:dup-0')

      storeHistory(stack.mongoUri, session.sessionId, session.userId)
      await newTask(page)
      await page
        .getByText('Open the dup history E2E_DELIVERY:dup-0', { exact: true })
        .first()
        .click()
      await page.getByText('Dup filler 258', { exact: true }).waitFor()
      const seen: string[] = []
      const note = async (when: string) => {
        const n = await copies(page)

        seen.push(`${when}=${n}`)
        console.log(`REPRO copies ${when}: ${n}`)
      }

      await send(page, PROMPT)
      await page.waitForTimeout(1500)
      await send(page, PROMPT)
      await page.getByText('Queued messages').waitFor()
      await note('queued')
      await page.getByRole('button', { name: 'Take back' }).first().click()
      for (let s = 0; s < 6; s++) {
        await page.waitForTimeout(5000)
        await note(`hold+${(s + 1) * 5}s`)
      }
      await page.screenshot({ path: `${artifacts}/repro-dup-during-turn.png` })
      await page.locator('button[title="Stop"]').click()
      await page.getByText('Turn stopped').waitFor()
      await page.waitForTimeout(5000)
      await note('stopped')
      await newTask(page)
      await page
        .getByText('Open the dup history E2E_DELIVERY:dup-0', { exact: true })
        .first()
        .click()
      await page.getByText(PROMPT, { exact: true }).first().waitFor()
      await page.waitForTimeout(3000)
      await note('reopened')
      await page.screenshot({ path: `${artifacts}/repro-dup-after.png` })
      console.log(`REPRO summary: ${seen.join(' ')}`)
      if (seen.some((entry) => !entry.endsWith('=1')))
        throw new Error(`The message sent once is shown more than once: ${seen.join(' ')}`)
    },
  },
]
