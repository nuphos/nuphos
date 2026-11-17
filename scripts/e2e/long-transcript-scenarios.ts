// A conversation longer than any window the app or the backend reads at once:
// a turn's end, opening it and scrolling back must each show every message once, in order.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { client } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
// More than the 200 messages a finished turn reads back, and than the app's first page.
const EARLIER = 260
const filler = (n: number) => `Filler ${String(n).padStart(3, '0')}`

/** Stores `EARLIER` messages after the session's own, as a long history would hold them. */
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
      sessionId, userId, messageId: 'filler-' + n, index: stored + n,
      role: n % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text: 'Filler ' + String(n).padStart(3, '0') }],
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

/** The open conversation's text, top to bottom. */
const transcript = (page: Page) =>
  page.evaluate(
    () =>
      (
        document
          .querySelector('.user-message-bubble')
          ?.closest('.flex.flex-col.gap-4') as HTMLElement | null
      )?.innerText ?? '',
  )

export const longTranscriptScenarios: Scenario[] = [
  {
    name: 'a long conversation shows every message once after a turn and when scrolled back to its start',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Scroll back E2E_DELIVERY:long-0')
      await page.getByText('ACK E2E_DELIVERY:long-0').waitFor()
      const session = await sessionFor(stack, 'E2E_DELIVERY:long-0')

      storeHistory(stack.mongoUri, session.sessionId, session.userId)
      // Reopened from the server, it shows its newest page.
      await page.reload()
      await page.getByText(filler(EARLIER - 1), { exact: true }).waitFor()
      // The turn ends with the stored tail of a transcript longer than it reads back.
      await send(page, 'After the long history E2E_DELIVERY:long-1')
      await page.getByText('ACK E2E_DELIVERY:long-1').waitFor()
      await page.screenshot({ path: `${artifacts}/long-transcript-after-turn.png` })
      for (let attempt = 0; attempt < 20; attempt++) {
        const more = page.getByRole('button', { name: 'Load earlier messages' })

        if ((await more.count()) === 0) {
          if ((await page.getByText('Loading earlier messages…').count()) === 0) break
          await page.waitForTimeout(200)
          continue
        }
        await more.click()
        await page.getByText('Loading earlier messages…').waitFor({ state: 'detached' })
      }
      const text = await transcript(page)
      const fillers = [...text.matchAll(/Filler (\d{3})/g)].map((match) => Number(match[1]))
      const order = [
        'Scroll back E2E_DELIVERY:long-0',
        'ACK E2E_DELIVERY:long-0',
        filler(0),
        filler(EARLIER - 1),
        'After the long history E2E_DELIVERY:long-1',
        'ACK E2E_DELIVERY:long-1',
      ].map((line) => text.indexOf(line))

      await page.screenshot({ path: `${artifacts}/long-transcript-scrolled-back.png` })
      if (fillers.join() !== Array.from({ length: EARLIER }, (_, n) => n).join())
        throw new Error(`Messages missing, repeated or out of order: ${fillers.join(',')}`)
      if (order.some((at, i) => at < 0 || (i > 0 && at < order[i - 1]!)))
        throw new Error(`The conversation is out of order: ${order.join(',')}`)
      for (const once of ['After the long history E2E_DELIVERY:long-1', 'ACK E2E_DELIVERY:long-1'])
        if (text.split(once).length !== 2) throw new Error(`"${once}" is not shown exactly once`)
    },
  },
]
