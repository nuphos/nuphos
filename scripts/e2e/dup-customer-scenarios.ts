// Repro only (not for merge): the flow behind nuphos/nuphos#4260. A long conversation whose
// stored history holds messages with no parts; reads of it take about a second; a message
// starts a long turn that asks a question; a second message is queued and taken back two
// seconds later; and, in one case, the chat stream drops twice mid-turn.
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { client } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'
import { send } from './ui.ts'

import type { NetProxy } from './net-proxy.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const release = join(artifacts, 'release')

/** A new conversation: the Tasks tab's New task, or the 0.115.1 sidebar's New agent. */
async function newTask(page: Page) {
  const tasks = page.getByRole('tab', { name: 'Tasks' })

  if (await tasks.count()) {
    await tasks.click()
    await page.getByRole('button', { name: 'New task', exact: true }).click()
  } else {
    await page.getByRole('button', { name: 'New agent' }).first().click()
  }
}

function run(script: string, args: string[]) {
  return execFileSync('bun', ['-e', script, ...args], { cwd: BACKEND_DIR, timeout: 20_000 })
    .toString()
    .trim()
}

/** Stores 260 earlier messages; every fourth one has no parts at all. */
function storeHistory(mongoUri: string, sessionId: string, userId: string, tag: string) {
  run(
    `
    import { MongoClient } from 'mongodb'
    const [uri, sessionId, userId, tag] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    const messages = db.collection('agent_messages')
    const stored = await messages.countDocuments({ sessionId, userId })
    const now = new Date()
    await messages.insertMany(Array.from({ length: 260 }, (_, n) => ({
      sessionId, userId, messageId: tag + '-filler-' + n, index: stored + n,
      role: n % 2 === 0 ? 'user' : 'assistant',
      parts: n % 4 === 1 ? [] : [{ type: 'text', text: tag + ' filler ' + String(n).padStart(3, '0') }],
      createdAt: now, updatedAt: now,
    })))
    await db.collection('agent_conversations').updateOne({ sessionId, userId }, {
      $set: { messageCount: stored + 260, transcriptUpdatedAt: now, lastActiveAt: now },
    })
    await client.close()`,
    [mongoUri, sessionId, userId, tag],
  )
}

function storedCount(mongoUri: string, text: string) {
  return run(
    `
    import { MongoClient } from 'mongodb'
    const [uri, text] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const n = await client.db('nuphos_e2e').collection('agent_messages')
      .countDocuments({ role: 'user', 'parts.text': text })
    console.log(String(n))
    await client.close()`,
    [mongoUri, text],
  )
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

const CASES: { label: string; setup: (proxy: NetProxy) => void }[] = [
  { label: 'slow-reads', setup: (proxy) => proxy.slow(1000, 0) },
  { label: 'slow-reads-cut', setup: (proxy) => (proxy.slow(1000, 0), proxy.cutChat(2, 4000)) },
]

export function dupCustomerScenarios(proxy: NetProxy): Scenario[] {
  return [
    {
      name: 'REPRO #4260: a message sent once shows once through the customer flow',
      run: async (page: Page, stack: Stack) => {
        const lines: string[] = []

        for (const { label, setup } of CASES) {
          const opener = `Open dupc ${label} E2E_DELIVERY:dupc-open-${label}`
          const prompt = `Please check the deploy and ask me E2E_ASK E2E_WAIT_RELEASE E2E_DELIVERY:dupc-${label}`
          const copies = () =>
            page.locator('.user-message-bubble:visible').filter({ hasText: prompt }).count()
          const seen: string[] = []
          const note = async (when: string) => {
            const n = await copies()

            seen.push(`${when}=${String(n)}`)
            console.log(`REPRO ${label} ${when}: ${String(n)}`)
          }
          const reopen = async () => {
            await newTask(page)
            const panel = page.getByRole('tabpanel', { name: 'Tasks' })
            const scope = (await panel.count()) ? panel : page

            await scope.getByText(`Open dupc ${label}`).first().click()
          }

          rmSync(release, { force: true })
          proxy.reset()
          await newTask(page)
          await send(page, opener)
          await page.getByText(`ACK E2E_DELIVERY:dupc-open-${label}`).waitFor({ timeout: 60_000 })
          const session = await sessionFor(stack, `E2E_DELIVERY:dupc-open-${label}`)

          storeHistory(stack.mongoUri, session.sessionId, session.userId, `dupc-${label}`)
          await reopen()
          await page.getByText(`dupc-${label} filler 258`, { exact: true }).waitFor()
          proxy.log.length = 0
          setup(proxy)
          await send(page, prompt)
          await page.waitForTimeout(2600)
          await send(page, `ok go E2E_DELIVERY:dupc-second-${label}`)
          try {
            await page.getByRole('button', { name: 'Take back' }).first().click({ timeout: 8000 })
            await note('taken-back')
          } catch {
            await note('no-take-back')
          }
          for (let s = 1; s <= 8; s++) {
            await page.waitForTimeout(5000)
            await note(`turn+${String(s * 5)}s`)
          }
          await page.screenshot({ path: `${artifacts}/dupc-${label}-during.png` })
          writeFileSync(release, '')
          try {
            await page
              .getByText(`ACK E2E_DELIVERY:dupc-${label}`)
              .first()
              .waitFor({ timeout: 60_000 })
          } catch {
            console.log(`REPRO ${label}: no ACK within 60s`)
          }
          for (let s = 1; s <= 3; s++) {
            await page.waitForTimeout(5000)
            await note(`after+${String(s * 5)}s`)
          }
          await page.screenshot({ path: `${artifacts}/dupc-${label}-after.png` })
          proxy.reset()
          await reopen()
          await page.waitForTimeout(5000)
          await note('reopened')
          await page.screenshot({ path: `${artifacts}/dupc-${label}-reopened.png` })
          const line = `${label}: ${seen.join(' ')} | stored=${storedCount(stack.mongoUri, prompt)} | proxy ${proxy.log.join(', ') || '-'}`

          console.log(`REPRO ${line}`)
          lines.push(line)
        }
        rmSync(release, { force: true })
        console.log(`REPRO summary:\n${lines.join('\n')}`)
        if (lines.some((line) => /=([2-9]|\d\d)\b/.test(line.split(' | ')[0] ?? '')))
          throw new Error(`A message sent once showed more than once:\n${lines.join('\n')}`)
      },
    },
  ]
}
