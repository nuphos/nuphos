// Quote captures for #3548: the Bot chat, posts stored as others leave them, both themes.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { artifacts } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

export async function openBotChat(page: Page) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
  await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
}

/** Stores a post as Slack or a teammate leaves one, which this single-user stack cannot send. */
export function store(stack: Stack, sessionId: string, id: string, metadata: object, text: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, sessionId, id, metadata, text] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const conversation = await db.collection('agent_conversations').findOne({ sessionId })
    const now = new Date()
    await db.collection('agent_messages').insertOne({
      sessionId, userId: conversation.userId, messageId: id, index: conversation.messageCount,
      role: 'user', parts: [{ type: 'text', text }],
      metadata: { ...JSON.parse(metadata), sentAt: now.toISOString() },
      createdAt: now, updatedAt: now,
    })
    // Read by the chat's agents, as if it had woken them: it is a picture, not news for them.
    const read = Object.fromEntries((conversation.agentSessionIds ?? []).map((id) => ['agentReadIndex.' + id, conversation.messageCount]))
    await db.collection('agent_conversations').updateOne({ sessionId }, {
      $set: { messageCount: conversation.messageCount + 1, transcriptUpdatedAt: now, lastActiveAt: now },
      $max: read,
    })
    await client.close()`

  execFileSync(
    'bun',
    ['-e', script, stack.mongoUri, sessionId, id, JSON.stringify(metadata), text],
    { cwd: resolve(import.meta.dirname, '../../apps/backend'), timeout: 20_000 },
  )
}

export async function shoot(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((theme) => {
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(theme)
    }, theme)
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${artifacts}/${name}-${theme}.png` })
  }
}

export const QUOTED =
  'Customers are asking for a DPA before they sign. Can we send the standard one, or does legal need to review each request?'
