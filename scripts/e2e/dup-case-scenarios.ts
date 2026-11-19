// Repro only (not for merge): the same Task open in two windows, and a second send
// while the first is still pending. Each message and reply must show once.
import { artifacts } from './processes.ts'
import { stored } from './dup-net-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { NetProxy } from './net-proxy.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const count = async (page: Page, prompt: string, marker: string) => {
  const users = await page.locator('.user-message-bubble:visible').filter({ hasText: prompt }).count()
  const acks = await page.getByText(`ACK ${marker}`, { exact: true }).locator('visible=true').count()

  return `user=${String(users)} ack=${String(acks)}`
}
const ack = (page: Page, marker: string) =>
  page.getByText(`ACK ${marker}`, { exact: true }).first().waitFor({ timeout: 90_000 }).then(() => true, () => false)
const reopen = async (page: Page, title: string) => {
  await newTask(page)
  await page.getByRole('tabpanel', { name: 'Tasks' }).getByText(title).first().click({ timeout: 10_000 })
  await page.waitForTimeout(4000)
}

export function dupCaseScenarios(proxy: NetProxy): Scenario[] {
  const lines: string[] = []
  const note = (line: string) => {
    console.log(`REPRO ${line}`)
    lines.push(line)
  }

  return [
    {
      name: 'REPRO: the same Task open in two windows shows each message once',
      run: async (page: Page, stack: Stack) => {
        const a = { prompt: 'Dup two windows first E2E_DELIVERY:dup2w-a', marker: 'E2E_DELIVERY:dup2w-a' }
        const b = { prompt: 'Dup two windows second E2E_DELIVERY:dup2w-b', marker: 'E2E_DELIVERY:dup2w-b' }
        const c = { prompt: 'Dup two windows third E2E_DELIVERY:dup2w-c', marker: 'E2E_DELIVERY:dup2w-c' }
        const all = [a, b, c]
        const report = async (where: string, pages: Page[]) => {
          for (const [i, p] of pages.entries())
            note(`two-windows ${where} window${String(i + 1)}: ${(await Promise.all(all.map(async (m) => count(p, m.prompt, m.marker)))).join(' | ')}`)
        }

        await newTask(page)
        await send(page, a.prompt)
        await ack(page, a.marker)
        const context = page.context()
        const before = context.pages().length

        await page.keyboard.press('Control+Shift+N')
        let second: Page | undefined

        for (let i = 0; i < 40 && !second; i++) {
          await page.waitForTimeout(500)
          const origin = new URL(page.url()).origin

          second = context
            .browser()
            ?.contexts()
            .flatMap((x) => x.pages())
            .find((p) => p !== page && p.url().startsWith(origin))
        }
        if (!second) {
          note(`two-windows: no second window opened (pages ${String(before)} → ${String(context.pages().length)})`)

          return
        }
        await second.waitForLoadState()
        await second.getByRole('tabpanel', { name: 'Tasks' }).getByText('Dup two windows first').first().click({ timeout: 30_000 })
        await second.waitForTimeout(3000)
        await send(second, b.prompt)
        const ackB = await ack(second, b.marker)
        await page.waitForTimeout(5000)
        await report(`after window2 sent (acked=${String(ackB)})`, [page, second])
        await send(page, c.prompt)
        const ackC = await ack(page, c.marker)
        await page.waitForTimeout(5000)
        await report(`after window1 sent again (acked=${String(ackC)})`, [page, second])
        await page.screenshot({ path: `${artifacts}/dup2w-window1.png` })
        await second.screenshot({ path: `${artifacts}/dup2w-window2.png` })
        await reopen(page, 'Dup two windows first')
        await report('window1 reopened', [page])
        note(`two-windows stored: ${all.map((m) => stored(stack.mongoUri, m.marker)).join(' | ')}`)
        await second.close().catch(() => {})
      },
    },
    {
      name: 'REPRO: a second send while the first is still pending shows each message once',
      run: async (page: Page, stack: Stack) => {
        const cases = [
          { label: 'different text', texts: ['Dup pending one E2E_DELIVERY:duppend-1', 'Dup pending two E2E_DELIVERY:duppend-2'] },
          { label: 'same text twice', texts: ['Dup pending same E2E_DELIVERY:duppend-s', 'Dup pending same E2E_DELIVERY:duppend-s'] },
        ]

        for (const { label, texts } of cases) {
          const markers = [...new Set(texts.map((t) => t.slice(t.indexOf('E2E_DELIVERY'))))]

          await newTask(page)
          proxy.reset()
          proxy.slow(2500, 0)
          await send(page, texts[0]!)
          await page.waitForTimeout(300)
          await send(page, texts[1]!)
          for (const m of markers) await ack(page, m)
          proxy.reset()
          await page.waitForTimeout(8000)
          const uniq = [...new Set(texts)]
          const live = (await Promise.all(uniq.map(async (t) => count(page, t, t.slice(t.indexOf('E2E_DELIVERY')))))).join(' | ')

          await page.screenshot({ path: `${artifacts}/duppend-${label.replace(/ /g, '-')}.png` })
          await reopen(page, uniq[0]!.split(' E2E')[0]!)
          const reopened = (await Promise.all(uniq.map(async (t) => count(page, t, t.slice(t.indexOf('E2E_DELIVERY')))))).join(' | ')

          note(`pending ${label}: live ${live} | reopened ${reopened} | stored ${markers.map((m) => stored(stack.mongoUri, m)).join(' | ')}`)
        }
        console.log(`REPRO summary:\n${lines.join('\n')}`)
      },
    },
  ]
}
