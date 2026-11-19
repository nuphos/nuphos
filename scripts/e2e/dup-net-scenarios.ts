// Repro only (not for merge): a message sent once, and its reply, must each show once
// when the connection is slow or the chat stream drops mid-turn and the Desktop reconnects.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { NetProxy } from './net-proxy.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** How many stored messages of each role carry the marker. */
function stored(mongoUri: string, marker: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, marker] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const rows = await client.db('nuphos_e2e').collection('agent_messages')
      .find({ 'parts.text': { $regex: marker } }, { projection: { role: 1 } }).toArray()
    const count = (role) => rows.filter((row) => row.role === role).length
    console.log('user=' + count('user') + ' assistant=' + count('assistant'))
    await client.close()`

  return execFileSync('bun', ['-e', script, mongoUri, marker], { cwd: BACKEND_DIR, timeout: 20_000 })
    .toString()
    .trim()
}

const CASES: { label: string; setup: (proxy: NetProxy) => void }[] = [
  { label: 'slow', setup: (proxy) => proxy.slow(1500, 300) },
  { label: 'cut-mid-reply', setup: (proxy) => proxy.cutChat(1, 400) },
  { label: 'cut-twice-slow', setup: (proxy) => (proxy.slow(800, 200), proxy.cutChat(2, 300)) },
  { label: 'drop-before-headers', setup: (proxy) => proxy.dropChatBeforeHeaders(1) },
  {
    label: 'drop-then-cut-slow',
    setup: (proxy) => (proxy.slow(800, 200), proxy.dropChatBeforeHeaders(1), proxy.cutChat(1, 300)),
  },
]

export function dupNetScenarios(proxy: NetProxy): Scenario[] {
  return [
    {
      name: 'REPRO: a message and its reply show once on a slow or dropped connection',
      run: async (page: Page, stack: Stack) => {
        const lines: string[] = []
        let duplicated = false

        for (const { label, setup } of CASES) {
          const marker = `E2E_DELIVERY:dupnet-${label}`
          const prompt = `Dup net ${label} ${marker}`
          const users = () =>
            page.locator('.user-message-bubble:visible').filter({ hasText: prompt }).count()
          const acks = () => page.getByText(`ACK ${marker}`, { exact: true }).locator('visible=true').count()

          await newTask(page)
          proxy.reset()
          proxy.log.length = 0
          setup(proxy)
          await send(page, prompt)
          let acked = true

          try {
            await page.getByText(`ACK ${marker}`, { exact: true }).first().waitFor({ timeout: 90_000 })
          } catch {
            acked = false
          }
          proxy.reset()
          await page.waitForTimeout(5000)
          const live = `user=${String(await users())} ack=${String(await acks())}`

          await page.screenshot({ path: `${artifacts}/dupnet-${label}-live.png` })
          console.log(`REPRO ${label} live: acked=${String(acked)} ${live} | proxy ${proxy.log.join(', ') || '-'}`)
          await newTask(page)
          let reopened = 'not reopened'

          try {
            // The Task's row in the sidebar, not a hidden pane that still holds its messages.
            await page
              .getByRole('tabpanel', { name: 'Tasks' })
              .getByText(`Dup net ${label} `)
              .first()
              .click({ timeout: 10_000 })
            await page.waitForTimeout(4000)
            reopened = `user=${String(await users())} ack=${String(await acks())}`
          } catch (error) {
            reopened = `not reopened (${String(error).split('\n')[0]})`
          }

          await page.screenshot({ path: `${artifacts}/dupnet-${label}-reopened.png` })
          const db = stored(stack.mongoUri, marker)
          const line = `${label}: acked=${String(acked)} live ${live} | reopened ${reopened} | stored ${db} | proxy ${proxy.log.join(', ') || '-'}`

          console.log(`REPRO ${line}`)
          lines.push(line)
          if (/(user|ack|assistant)=([2-9]|\d\d)/.test(line)) duplicated = true
        }
        console.log(`REPRO summary:\n${lines.join('\n')}`)
        if (duplicated) throw new Error(`A message or reply showed more than once:\n${lines.join('\n')}`)
      },
    },
  ]
}
