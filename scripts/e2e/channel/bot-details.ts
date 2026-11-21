// #3590: a Bot chat's name opens the Bot's details beside the chat; the title bar keeps only the
// name and status. Runs in the E2E Bot's chat, whose setup has finished, and leaves it there closed.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { joinTeam } from '../dashboard-scenarios.ts'
import { LAPTOP, laptopOnline } from '../laptop-fixture.ts'
import { artifacts } from '../processes.ts'
import { botDetailsToggle, checkBotDetailsFloating, pickInRow, setBotDetails } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { CDPSession, Locator, Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')
const SECOND = 'Details Bot'
const RENAMED = 'Scout Bot'
const GROUP = 'Details group'

function details(page: Page) {
  return page.getByRole('complementary', { name: 'Bot details' })
}

/** A light capture of the window as it is now. */
async function shoot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  // The panel slides in and out; let it land.
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${artifacts}/bot-details-${name}.png` })
}

/** Replies to the newest post, then scrolls up a little so posts pass under the reply bar (#3553). */
async function replyAndScroll(page: Page) {
  const row = page.locator('.group\\/post').last()

  await row.hover()
  await row.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel reply' }).waitFor()
  await page.mouse.move(400, 400)
  await page.mouse.wheel(0, -160)
}

async function openChat(page: Page, name: string) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: name }).first().click()
  await page.locator(`[aria-placeholder="Message ${name}"]`).waitFor()
}

async function call(stack: Stack, path: string, body: object, method = 'POST') {
  const response = await fetch(`${stack.apiUrl}${path}`, {
    method,
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

/** Floating, the panel ends above a bar the composer holds over the chat. */
async function stopsAbove(page: Page, bar: Locator) {
  await checkBotDetailsFloating(page)
  const panel = await details(page).boundingBox()
  const top = await bar.boundingBox()

  if (!panel || !top || panel.y + panel.height > top.y)
    throw new Error(`The floating details run past the bar: ${JSON.stringify({ panel, top })}`)
}

/** On a computer whose disk is almost full, a status banner sits on the composer (#3181). */
async function shootBanner(page: Page, stack: Stack, cdp: CDPSession) {
  const goOffline = await laptopOnline(stack, { diskPercent: 93 })
  const banner = page.getByRole('status').filter({ hasText: 'disk is almost full' })
  const pick = async (runtime: string, agent: RegExp) => {
    await page.getByRole('button', { name: /^Runtime:/ }).click()
    await pickInRow(page, runtime, agent)
  }

  try {
    await pick(LAPTOP, /Claude Code/)
    await banner.waitFor()
    await shoot(page, 'owner-wide-banner')
    await cdp.send('Emulation.setDeviceMetricsOverride', NARROW)
    await details(page).waitFor({ state: 'detached' })
    await botDetailsToggle(page).click()
    await stopsAbove(page, banner)
    await shoot(page, 'owner-narrow-banner')
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await pick('E2E fixture agent', /^E2E fixture agent.*Claude Code/)
    goOffline()
  }
  await banner.waitFor({ state: 'detached' })
  // Its agent is a runtime no one can switch off, so scenarios later in the run would find it.
  const forgot = await fetch(`${stack.apiUrl}/agent/devices/e2e-laptop`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${stack.token}` },
  })

  if (!forgot.ok) throw new Error(`Forgetting the laptop answered ${forgot.status}`)
}

const NARROW = { width: 820, height: 760, deviceScaleFactor: 0, mobile: false }

const scenario: Scenario = {
  name: "a Bot chat's name opens the Bot's details, which stay open from Bot to Bot",
  // The Bot handed to a teammate in Mongo is one this viewer cannot read: its session, model
  // settings and mode answer 404, which the panel and the composer leave out.
  expected:
    /"method":"GET","path":"\/agent\/(conversations\/[0-9a-f-]+(\/model-config)?|auto-mode\/bypass)","status":404,"error_code":"not_found"/,
  run: async (page, stack) => {
    const second = await call(stack, '/agent/bots', {
      title: SECOND,
      avatar: '07-ada',
      agentRuntime: 'claude-code',
    })
    const mate = await joinTeam(stack, 'details-mate')
    const group = await call(stack, '/agent/channels', { title: GROUP, group: true })

    await call(stack, `/agent/conversations/${group.sessionId}/participants`, {
      userIds: [mate.id],
    })

    await openChat(page, 'E2E Bot')
    const titlebar = page.locator('.workspace-agent-titlebar').last()

    for (const name of ['Triggers', 'Task', 'Desktop'])
      if ((await titlebar.getByRole('button', { name, exact: true }).count()) > 0)
        throw new Error(`The title bar still has ${name}`)
    await expectOpen(page, false, 'A fresh profile')
    await shoot(page, 'owner-wide-closed')
    await botDetailsToggle(page).click()
    await expectOpen(page, true, 'After a click on the name')
    const card = details(page).getByRole('region', { name: 'E2E Bot' })

    await card.waitFor()
    await details(page).getByText('Bot instructions').waitFor()
    await shoot(page, 'owner-wide-open')
    // Replying: the transcript runs under the reply bar, beside the details.
    await replyAndScroll(page)
    await shoot(page, 'owner-wide-replying')
    await page.getByRole('button', { name: 'Cancel reply' }).click()
    // Its owner renames the Bot in Edit Bot, the dialog the title bar's rename opened.
    await card.getByRole('button', { name: 'Edit Bot' }).click()
    const name = page.getByRole('dialog').getByRole('textbox', { name: 'Bot name' })

    if ((await name.inputValue()) !== 'E2E Bot') throw new Error('Edit Bot has no name to change')
    await shoot(page, 'owner-edit-bot')
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })

    // Closing Edit Bot hands focus back to its pencil without opening the pencil's tooltip
    // (#3961), so one Esc inside the panel closes it and hands focus back to the name.
    const edit = card.getByRole('button', { name: 'Edit Bot' })

    if (!(await edit.evaluate((button) => button === document.activeElement)))
      throw new Error('Closing Edit Bot did not hand focus back to its button')
    // Longer than the tooltip's 300 ms delay, so a tooltip that would open has opened.
    await page.waitForTimeout(600)
    if ((await edit.getAttribute('data-popup-open')) !== null)
      throw new Error('Focus handed back to Edit Bot opened its tooltip (#3961)')
    await page.keyboard.press('Escape')
    await details(page).waitFor({ state: 'detached' })
    await expectOpen(page, false, 'After Esc')
    if (!(await botDetailsToggle(page).evaluate((toggle) => toggle === document.activeElement)))
      throw new Error('Esc did not hand focus back to the name')
    // ⌘I opens it again.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyI' : 'Control+KeyI')
    await expectOpen(page, true, 'After ⌘I')

    // Another Bot's chat opens with the details still open, now of that Bot.
    await openChat(page, SECOND)
    await expectOpen(page, true, `In ${SECOND}'s chat`)
    await details(page).getByRole('region', { name: SECOND }).waitFor()
    // Made without a computer, it says only which agent it is.
    await details(page).getByText('Claude Code', { exact: true }).waitFor()
    // Renaming in Edit Bot renames the Bot, its chat and the name button.
    await details(page).getByRole('button', { name: 'Edit Bot' }).click()
    await page.getByRole('dialog').getByRole('textbox', { name: 'Bot name' }).fill(RENAMED)
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await details(page).getByRole('region', { name: RENAMED }).waitFor()
    await botDetailsToggle(page).getByText(RENAMED).waitFor()
    const banners = await page.context().newCDPSession(page)

    await shootBanner(page, stack, banners)
    await banners.detach()

    // A group chat keeps its header: no Bot details, its members on the right.
    await openChat(page, GROUP)
    if ((await botDetailsToggle(page).count()) > 0) throw new Error('A group chat has Bot details')
    await shoot(page, 'group-wide')

    // A Bot someone else owns: no Edit Bot, and the rest as before.
    handOver(stack, second.sessionId, mate.id)
    await page.reload()
    await openChat(page, RENAMED)
    await details(page).getByRole('region', { name: RENAMED }).waitFor()
    if ((await details(page).getByRole('button', { name: 'Edit Bot' }).count()) > 0)
      throw new Error("A teammate's Bot offers Edit Bot")
    // The Task's empty note is not the Bot's: its card already fills the panel.
    if ((await details(page).getByText('Nothing here yet').count()) > 0)
      throw new Error("A teammate's Bot says its Task has nothing yet")
    await shoot(page, 'teammate-wide-open')

    // Narrow: the chat pane under 600px.
    const cdp = await page.context().newCDPSession(page)

    try {
      await cdp.send('Emulation.setDeviceMetricsOverride', NARROW)
      // #4077: with no room beside, the open details close, and open by hand as a popover.
      await details(page).waitFor({ state: 'detached' })
      await expectOpen(page, false, 'Narrowed')
      await botDetailsToggle(page).click()
      await checkBotDetailsFloating(page)
      await shoot(page, 'teammate-narrow-open')
      // Opened by hand in one Bot chat, they start closed in the next.
      await openChat(page, 'E2E Bot')
      await expectOpen(page, false, 'In the next Bot chat, narrow')
      await setBotDetails(page, true)
      await checkBotDetailsFloating(page)
      // Right of the panel, which floats from the name at the pane's left.
      await page.mouse.click(780, 400)
      await expectOpen(page, false, 'After a press on the transcript')
      const saved = await page.evaluate(() => localStorage.getItem('nuphos.botDetailsOpen'))

      if (saved !== '1') throw new Error(`A press outside saved the details as ${String(saved)}`)
      await shoot(page, 'owner-narrow-closed')
      await setBotDetails(page, true)
      await checkBotDetailsFloating(page)
      await shoot(page, 'owner-narrow-open')
      // Replying, the popover ends above the reply bar. A press on a post is a press outside, so
      // the reply starts first.
      await setBotDetails(page, false)
      await replyAndScroll(page)
      await setBotDetails(page, true)
      // The reply bar, not the status banner the composer always holds, closed and inert.
      await stopsAbove(page, page.locator('[data-composer-overlay]:not([inert])'))
      await shoot(page, 'owner-narrow-replying')
      await page.getByRole('button', { name: 'Cancel reply' }).click()
      await openChat(page, GROUP)
      await shoot(page, 'group-narrow')
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await cdp.detach()
    }
    await openChat(page, 'E2E Bot')
    // Wide again, the details are back beside the chat as saved; saved closed for the scenarios after.
    await expectOpen(page, true, 'Wide again')
    await setBotDetails(page, false)
    // Leave the lists as the scenarios after this one expect them: the Bot back with its
    // owner, then it, its chat and the group archived.
    const me = (await (
      await fetch(`${stack.apiUrl}/auth/me`, {
        headers: { authorization: `Bearer ${stack.token}` },
      })
    ).json()) as { id: string }

    handOver(stack, second.sessionId, me.id)
    for (const sessionId of [second.sessionId, group.sessionId])
      await call(stack, `/agent/conversations/${sessionId}/archive`, { archived: true }, 'PATCH')
  },
}

export default scenario
