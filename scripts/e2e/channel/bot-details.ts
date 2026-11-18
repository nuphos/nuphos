// #3590: a Bot chat's name opens the Bot's details beside the chat; the title bar keeps only the
// name and status. Runs in the E2E Bot's chat, whose setup has finished, and leaves it there closed.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { joinTeam } from '../dashboard-scenarios.ts'
import { artifacts } from '../processes.ts'
import { botDetailsToggle, setBotDetails } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')
const SECOND = 'Details Bot'

function details(page: Page) {
  return page.getByRole('complementary', { name: 'Bot details' })
}

async function theme(page: Page, mode: 'light' | 'dark') {
  await page.evaluate((next) => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(next)
  }, mode)
  await page.waitForTimeout(300)
}

/** Light and dark captures of the window as it is now. */
async function shoot(page: Page, name: string) {
  // The panel slides in; let it land.
  await page.waitForTimeout(500)
  for (const mode of ['light', 'dark'] as const) {
    await theme(page, mode)
    await page.screenshot({ path: `${artifacts}/bot-details-${name}-${mode}.png` })
  }
  await theme(page, 'light')
}

async function openBotChat(page: Page, name: string) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: name }).first().click()
  await page.locator(`[aria-placeholder="Message ${name}"]`).waitFor()
}

async function call(stack: Stack, path: string, body: object) {
  const response = await fetch(`${stack.apiUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: stack.teamId, ...body }),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as { sessionId: string }
}

/** Hands a Bot to another member, as if they had made it. No route does this, so Mongo does. */
function handOver(stack: Stack, botId: string, userId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    await client.db('nuphos_e2e').collection('agent_conversations')
      .updateOne({ sessionId: process.argv[2] }, { $set: { userId: process.argv[3] } })
    await client.close()`

  execFileSync('bun', ['-e', script, stack.mongoUri, botId, userId], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
}

async function expectOpen(page: Page, open: boolean, why: string) {
  const state = await botDetailsToggle(page).getAttribute('aria-expanded')

  if (state !== String(open))
    throw new Error(`${why}: the details are ${state === 'true' ? 'open' : 'closed'}`)
}

/** In a narrow pane the panel floats under the name, start-aligned with it, as the Task summary floats. */
async function checkFloating(page: Page) {
  const toggle = await botDetailsToggle(page).boundingBox()
  const panel = await details(page).boundingBox()

  if (!toggle || !panel) throw new Error('The name or the floating details are not on screen')
  if (Math.abs(panel.x - toggle.x) > 1 || panel.y < toggle.y + toggle.height)
    throw new Error(
      `The details float at ${JSON.stringify(panel)}, not under ${JSON.stringify(toggle)}`,
    )
}

const scenario: Scenario = {
  name: "a Bot chat's name opens the Bot's details, which stay open from Bot to Bot",
  run: async (page, stack) => {
    const second = await call(stack, '/agent/bots', {
      title: SECOND,
      avatar: '07-ada',
      agentRuntime: 'claude-code',
      runtimeLabel: 'E2E details computer',
    })

    await openBotChat(page, 'E2E Bot')
    const titlebar = page.locator('.workspace-agent-titlebar').last()

    for (const name of ['Triggers', 'Task', 'Desktop'])
      if ((await titlebar.getByRole('button', { name, exact: true }).count()) > 0)
        throw new Error(`The title bar still has ${name}`)
    await expectOpen(page, false, 'A fresh profile')
    await botDetailsToggle(page).click()
    await expectOpen(page, true, 'After a click on the name')
    const card = details(page).getByRole('region', { name: 'E2E Bot' })

    await card.waitFor()
    await card.getByRole('button', { name: 'Edit Bot' }).waitFor()
    await details(page).getByText('Bot instructions').waitFor()
    await shoot(page, 'owner-wide')
    // Edit Bot opens the dialog the title bar's rename did.
    await card.getByRole('button', { name: 'Edit Bot' }).click()
    await page.getByRole('dialog').getByText('Edit Bot').first().waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })

    // Esc inside the panel closes it and hands focus back to the name.
    await card.getByRole('button', { name: 'Edit Bot' }).focus()
    await page.keyboard.press('Escape')
    await details(page).waitFor({ state: 'detached' })
    await expectOpen(page, false, 'After Esc')
    if (!(await botDetailsToggle(page).evaluate((toggle) => toggle === document.activeElement)))
      throw new Error('Esc did not hand focus back to the name')
    // ⌘I opens it again.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyI' : 'Control+KeyI')
    await expectOpen(page, true, 'After ⌘I')

    // Another Bot's chat opens with the details still open, now of that Bot.
    await openBotChat(page, SECOND)
    await expectOpen(page, true, `In ${SECOND}'s chat`)
    await details(page).getByRole('region', { name: SECOND }).waitFor()
    await details(page).getByText('E2E details computer · Claude Code').waitFor()

    // A Bot someone else owns: no Edit Bot, and the rest as before.
    const mate = await joinTeam(stack, 'details-mate')

    handOver(stack, second.sessionId, mate.id)
    await page.reload()
    await openBotChat(page, SECOND)
    await details(page).getByRole('region', { name: SECOND }).waitFor()
    if ((await details(page).getByRole('button', { name: 'Edit Bot' }).count()) > 0)
      throw new Error("A teammate's Bot offers Edit Bot")
    await shoot(page, 'teammate-wide')

    // Narrow: the chat pane under 600px.
    const cdp = await page.context().newCDPSession(page)

    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 820,
        height: 760,
        deviceScaleFactor: 0,
        mobile: false,
      })
      await page.waitForTimeout(500)
      await checkFloating(page)
      await shoot(page, 'teammate-narrow')
      // Floating, it is a popover: a press outside, here on the sidebar, closes it.
      await openBotChat(page, 'E2E Bot')
      await expectOpen(page, false, 'After a press outside the floating details')
      await setBotDetails(page, true)
      await checkFloating(page)
      await shoot(page, 'owner-narrow')
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await cdp.detach()
    }
    await setBotDetails(page, false)
  },
}

export default scenario
