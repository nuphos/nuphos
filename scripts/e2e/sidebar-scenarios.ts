// Scenarios about the sidebar itself.
import { agentEvents } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { checkDockToggleClear } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { screencast } from './question-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const sidebarScenarios: Scenario[] = [
  {
    // The pages' viewport was `overflow: hidden`, which focus still scrolls: every page showed cut off.
    name: 'every sidebar page shows from its left edge, never scrolled sideways',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Hello E2E_DELIVERY:sidebar')
      await page.getByText('ACK E2E_DELIVERY:sidebar').waitFor()
      await checkDockToggleClear(page, 'Task chat header')
      // Open, the dock's tab strip is what runs under the toggle.
      await page.getByRole('button', { name: 'Open workspace panel' }).click()
      await page.getByRole('button', { name: 'Close workspace panel' }).waitFor()
      await page.waitForTimeout(500)
      await checkDockToggleClear(page, 'dock tab strip', '[class*="--dock-toggle-pad"]')
      await page.getByRole('button', { name: 'Close workspace panel' }).click()
      for (const tab of ['Tasks', 'Inbox', 'Bots']) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${artifacts}/sidebar-${tab.toLowerCase()}.png` })
        const sideways = await page.evaluate(
          () => document.querySelector('.sidebar-swipe-viewport')?.scrollLeft,
        )

        must(sideways === 0, `the ${tab} page not to be scrolled sideways, got ${String(sideways)}`)
      }
    },
  },
]

export const botFoldScenarios: Scenario[] = [
  {
    // #2898: a Bot's tree opened by hand folded again whenever Bots was left.
    name: 'a Bot tree opened by hand stays open after Tasks and back, and after a reload',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const count = (event: string) =>
        agentEvents(stack).filter((logged) => logged === event).length
      const introductions = count('finish E2E_DELIVERY:missing')
      const asked = count('permission-asked E2E_DELIVERY:thread')
      // Its own Bot, so no scenario before it decides what the tree holds.
      const row = page.locator('[data-sidebar-row]').filter({ hasText: 'Fold Bot' }).first()
      const show = row.locator('[aria-label="Show sub-tasks"]')
      const hide = row.locator('[aria-label="Hide sub-tasks"]')
      const mustBeOpen = async (when: string) => {
        await until(
          `the Bot tree to show ${when}`,
          async () => (await show.count()) + (await hide.count()) === 1,
        )
        must((await hide.count()) === 1, `the opened Bot tree to stay open ${when}`)
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      // Bots already exist here, so New Bot sits in the + menu.
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByRole('menuitem', { name: 'New Bot' }).click()
      await page.getByRole('textbox', { name: 'Bot name' }).fill('Fold Bot')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await until(
        'the new Bot to introduce itself',
        async () => count('finish E2E_DELIVERY:missing') > introductions,
      )
      const bots = await api('GET', `/agent/conversations?teamId=${stack.teamId}&bots=true`)
      const bot = (bots.body as { conversations: { sessionId: string }[] }).conversations[0]!
      // Out of Full Access, its sub-agent waits for a person to allow its command and so stays
      // in the tree: a finished one sits behind the done badge, remembered before #2898 too.
      const mode = await api('PUT', '/agent/auto-mode/bypass', {
        sessionId: bot.sessionId,
        bypass: false,
      })

      must(mode.status === 200, `the Bot to leave Full Access, got ${String(mode.status)}`)
      await send(page, 'Start a thread E2E_THREAD E2E_DELIVERY:fold')
      await until(
        'the sub-agent to wait on its command',
        async () => count('permission-asked E2E_DELIVERY:thread') > asked,
      )
      // Folded until someone opens it.
      await show.click()
      await mustBeOpen('once opened')
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await page.getByRole('button', { name: 'New task', exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Bots' }).click()
      await mustBeOpen('after Tasks and back')
      await page.reload()
      await page.getByRole('tab', { name: 'Bots' }).click()
      await mustBeOpen('after a reload')
      await page.screenshot({ path: `${artifacts}/bot-tree-open-after-reload.png` })
      // Stop the waiting sub-agent, so the scenarios after this one find the computer free.
      const answered = () =>
        agentEvents(stack).filter(
          (event) => /^permission-(?!asked)/.test(event) && event.endsWith(' E2E_DELIVERY:thread'),
        ).length
      const before = answered()

      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E thread' }).first().click()
      await page.locator('button[title="Stop"]:visible').click()
      await until('the stopped sub-agent to let go of its command', async () => answered() > before)
      // Back in the Bot chat, where the scenarios after this one found the window before.
      await row.click()
    },
  },
  {
    // #3459: until a team's first listing arrived, Bots said "No Bots yet". A team the app has
    // not listed yet, opened while the backend is frozen, holds that listing for as long as needed.
    name: 'Bots shows its skeleton, not "No Bots yet", until a team\'s first listing arrives',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const team = await api('POST', '/teams', { name: 'Listing Team' })
      // A workspace's menu item also reads its icon's initials, as "LT Listing Team".
      const workspace = (name: string) =>
        page.getByRole('menuitem', { name: new RegExp(`${name}$`) })
      const switchTo = async (name: string) => {
        // The team switcher at the top of the sidebar, labelled with the team open now.
        await page
          .getByText(/^(?:E2E|Listing Team)$/)
          .first()
          .click()
        await page.getByRole('menuitem', { name: 'Switch workspace' }).click()
        await workspace(name).waitFor()
      }

      must(team.status < 300, `a second team, got ${String(team.status)}`)
      await switchTo('Listing Team')
      // Frames from the switch to the reveal, for a recording of the loading state and its end.
      const recording = await screencast(page, 'bots-first-listing')

      await stack.freezeBackend(async () => {
        await workspace('Listing Team').click()
        await page.getByRole('tab', { name: 'Bots' }).click()
        await page.waitForTimeout(1500)
        await page.screenshot({ path: `${artifacts}/bots-first-listing-loading.png` })
        must(
          (await page.getByText('No Bots yet').count()) === 0,
          'Bots not to say "No Bots yet" before its first listing arrived',
        )
        // Nor the main pane's New Bot intro, which can't yet say whether it is the first.
        must(
          (await page.locator('.t-bot-start.is-shown').count()) === 0,
          'the New Bot intro to wait for the first listing',
        )
      })
      await page.getByText('No Bots yet').waitFor()
      await page.locator('.t-bot-start.is-shown').getByText('Start with your first Bot').waitFor()
      // Past the reveals, so the capture shows where they land.
      await page.waitForTimeout(800)
      // The reveal moves each line as a whole: the faces still stand side by side.
      const faces = await page
        .locator('.t-bot-start img')
        .evaluateAll((images) => images.map((image) => image.getBoundingClientRect().left))

      must(
        faces.length === 3 && faces[0]! < faces[1]! && faces[1]! < faces[2]!,
        `the intro's three faces in a row, got left edges ${faces.join(', ')}`,
      )
      await page.screenshot({ path: `${artifacts}/bots-first-listing-empty.png` })
      await recording()
      // Back in the first team, where the scenarios after this one found the window before.
      await switchTo('E2E')
      await workspace('E2E').click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'Fold Bot' }).first().waitFor()
    },
  },
]
