// Helpers for the scenarios about a Bot reading its chat, shared with scenario files in ./channel.
import { randomUUID } from 'node:crypto'

import { forgetComputer } from './computer-scenarios.ts'
import { artifacts } from './processes.ts'
import { openComputers, pickInRow } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Locator, Page } from 'playwright-core'

/** A computer reporting Claude Code usage as Desktop's host does; with `diskPercent`, a live disk too. */
export async function computerWithUsage(
  stack: Stack,
  label: string,
  deviceId = randomUUID(),
  diskPercent?: number,
) {
  const auth = { authorization: `Bearer ${stack.token}` }
  const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      label,
      platform: 'darwin',
      allowLocalExec: true,
    }),
  })

  if (!registered.ok) throw new Error(`Registering answered ${String(registered.status)}`)
  const host = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
    { headers: auth } as unknown as string[],
  )

  host.addEventListener('message', (event) => {
    if (String(event.data).includes('"ping"')) host.send(JSON.stringify({ t: 'pong' }))
  })
  await new Promise((opened, failed) => {
    host.addEventListener('open', opened)
    host.addEventListener('error', failed)
  })
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()
  // Under a day and over one, so both forms of "resets in" show (#3732).
  const usage = {
    // Yuanlin's case: 87% used, which both the Runtimes row and the details read as 13% left.
    five_hour: { utilization: 87, resets_at: at(3) },
    seven_day: { utilization: 20, resets_at: at(2 * 24 + 5.5) },
  }

  host.send(
    JSON.stringify({
      t: 'status',
      status: {
        agents: {
          'claude-code': {
            cli: { installed: true, loggedIn: true },
            usage,
            usageAt: new Date().toISOString(),
          },
        },
        ...(diskPercent === undefined ? {} : { localMetrics: true }),
      },
    }),
  )
  const report = () =>
    host.send(
      JSON.stringify({
        t: 'metrics',
        metrics: {
          sampledAt: new Date().toISOString(),
          cpuPercent: 20,
          memory: { used: 4, total: 16 },
          disk: { used: diskPercent, total: 100 },
        },
      }),
    )
  const reporting = diskPercent === undefined ? undefined : setInterval(report, 4_000)

  if (reporting) report()

  // `forget` false leaves it registered, to connect again.
  return (forget = true) => {
    clearInterval(reporting)
    host.close()
    if (forget) forgetComputer(stack.mongoUri, deviceId)
  }
}

/** Puts the composer on a runtime: `row` opens its submenu and `item` names the runtime in it. */
export async function pickRuntime(page: Page, row: string, item: RegExp) {
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await pickInRow(page, row, item)
  // A Bot's move takes a moment; until it lands the composer still names the old runtime.
  await page.getByRole('button', { name: new RegExp(`^Runtime: .*${row}`) }).waitFor()
}

/** Shoots the composer in light; whether its runtime line shows the usage bar. */
export async function shootRuntimeLine(page: Page, name: string) {
  const bar = page.getByRole('progressbar', { name: 'Usage remaining' })
  const path = `${artifacts}/${name}-composer-light.png`

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await bar.waitFor({ timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(500)
  await page.locator('.composer-surface:visible').last().screenshot({ path })

  return (await bar.count()) > 0
}

/** The compact composer keeps reset timing in the usage tooltip. */
export async function shootChipResets(page: Page) {
  const composer = page.locator('.composer-surface:visible').last()
  const duration = composer.getByText(/^\d+h \d+m$/u)
  const usage = composer.getByRole('progressbar', { name: 'Usage remaining' })

  await usage.waitFor()
  if (await duration.isVisible()) throw new Error('The compact composer shows a reset duration')
  await page.screenshot({ path: `${artifacts}/usage-resets-chip-wide-light.png` })
  await usage.hover()
  await page.getByText(/13% left · resets in \d+h \d+m/u).waitFor()
  await page.screenshot({ path: `${artifacts}/usage-resets-chip-tooltip-light.png` })
  await page.mouse.move(0, 0)
}

/** #3732: the Computers page's agent row and the agent's own page each say when
 *  the usage resets, in days past a day and in hours under one. */
export async function shootUsageResets(page: Page, computer: string) {
  await openComputers(page)
  // The agent list sits under the usage history, whose row for the same agent shows no reset.
  const row = page
    .getByRole('button', { name: /Claude Code/ })
    .filter({ hasText: computer })
    .filter({ hasText: /resets in 2d 5h/u })
    .first()

  await row.waitFor({ timeout: 30_000 })
  await row.getByText(/^resets in \d+h \d+m$/u).waitFor({ timeout: 30_000 })
  await row.getByText(/^13% left$/u).waitFor({ timeout: 10_000 })
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${artifacts}/usage-resets-computers-light.png` })
  await row.click()
  // The runtime's details open in a side panel beside the list.
  const card = page.locator('aside[aria-label]').filter({ hasText: computer }).first()

  await card
    .getByText(/^resets in 2d 5h$/u)
    .first()
    .waitFor({ timeout: 30_000 })
  await card.getByText(/^13% left$/u).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${artifacts}/usage-resets-agent-light.png` })
  await page.getByText('Back to app', { exact: true }).click()
}

export type ListedConversation = {
  sessionId?: string
  title?: string
  avatar?: unknown
  kind?: string
  presence?: unknown
}

/** The team's conversation list, as Desktop reads it. */
export async function listedConversations(stack: Stack): Promise<ListedConversation[]> {
  const response = await fetch(`${stack.apiUrl}/agent/conversations?teamId=${stack.teamId}`, {
    headers: { authorization: `Bearer ${stack.token}` },
  })

  return ((await response.json()) as { conversations: ListedConversation[] }).conversations
}

export const isBotRow = (row: ListedConversation) => Boolean(row.avatar) && row.kind !== 'channel'

/** The E2E Bot's presence as the conversation list reports it (#3308). */
export async function botPresence(stack: Stack) {
  return (await listedConversations(stack)).find((row) => row.title === 'E2E Bot' && isBotRow(row))
    ?.presence
}

/** A Bot's sidebar row while it works: no spinner and no greyed-out name (#3522). */
export async function loadingFree(row: Locator, when: string) {
  for (const [selector, what] of [
    ['.animate-spin', 'a spinner'],
    ['.t-shimmer', 'a greyed-out name'],
  ])
    if ((await row.locator(selector).count()) > 0)
      throw new Error(`${when}, the Bot's row shows ${what}`)
}
