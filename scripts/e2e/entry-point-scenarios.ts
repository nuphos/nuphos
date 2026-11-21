// One scenario per way into the product (#4205): each starts where a person
// already is and clicks what they would click. None reaches a page through `⌘K`,
// which finds it by name whether or not the product points at it.
import { must } from './binding-access-scenarios.ts'
import { botDetailsToggle, setBotDetails } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** The Computers page, wherever the way in led. */
async function computersPage(page: Page) {
  await page.getByRole('region', { name: 'Runtimes' }).waitFor({ timeout: 15_000 })
}

/** The team's name, which is what the sidebar's workspace menu is called. */
async function teamName(stack: Stack) {
  const response = await fetch(`${stack.apiUrl}/teams`, {
    headers: { authorization: `Bearer ${stack.token}` },
  })

  if (!response.ok) throw new Error(`GET /teams answered ${String(response.status)}`)
  const teams = (await response.json()) as { teams?: { id: string; name: string }[] }
  const team = (teams.teams ?? []).find((row) => row.id === stack.teamId)

  if (!team) throw new Error('the signed-in account has no team to name')

  return team.name
}

/** The Task whose row these scenarios read. Long, so its title is clipped. */
export const LONG_TASK = 'Entry points into the product, read from the sidebar'

export const entryPointScenarios: Scenario[] = [
  {
    // #2797: Computers left the sidebar in #2232, and a public report after the
    // update called machines and runtimes "very well hidden".
    name: "the sidebar's workspace menu reaches Computers & runtimes",
    run: async (page, stack) => {
      // The sidebar's own menu button, which the team's name labels along with
      // its avatar, so the name alone does not find it.
      const workspace = page.locator('aside button[aria-haspopup="menu"]').first()

      await workspace.waitFor({ timeout: 15_000 })
      must(
        (await workspace.innerText()).includes(await teamName(stack)),
        "the sidebar's first menu button to be the workspace's own",
      )
      await workspace.click()
      const computers = page.getByRole('menuitem', { name: 'Computers & runtimes' })

      await computers.waitFor({ timeout: 10_000 })
      await computers.click()
      await computersPage(page)
    },
  },
  {
    // #2797's other way in, the one a person is most likely to meet: they are
    // already in a chat and want the computer it runs on.
    name: "a chat's runtime picker reaches Computers & runtimes",
    run: async (page) => {
      await page.getByRole('tab', { name: 'Tasks' }).click()
      const runtime = page.getByRole('button', { name: /^Runtime: / }).first()

      await runtime.waitFor({ timeout: 15_000 })
      await runtime.click()
      const manage = page.getByRole('menuitem', { name: 'Manage computers and runtimes' })

      await manage.waitFor({ timeout: 10_000 })
      await manage.click()
      await computersPage(page)
    },
  },
  {
    // The Desktop shape of #3873, where iOS lost exactly this: the chat's name
    // opens the details, and the details are the way into the Bot's own Task.
    name: "a Bot's chat reaches its details, and its details the Bot's own Task",
    run: async (page) => {
      await page.getByRole('tab', { name: 'Bots' }).click()
      const toggle = botDetailsToggle(page)

      await toggle.waitFor({ timeout: 15_000 })
      must(await toggle.isEnabled(), "the Bot chat's name to open its details")
      await setBotDetails(page, true)
      const panel = page.getByRole('complementary', { name: 'Bot details' })
      const task = panel.getByRole('button', { name: 'Task', exact: true })

      // A Bot still getting started has no Task to open yet, on purpose.
      await task.waitFor({ timeout: 30_000 })
      await task.click()
      await page.getByRole('textbox', { name: 'Message' }).first().waitFor({ timeout: 15_000 })
    },
  },
  {
    // #3910: the row's title scrolls on hover, and the marquee took the click
    // meant for the button. A button that cannot be clicked is not a way in.
    name: "a sidebar row's More button takes the click, not its scrolling title",
    run: async (page) => {
      await page.getByRole('tab', { name: 'Tasks' }).click()
      // A long title, so it is clipped and the marquee runs: #3910's condition.
      // The row's title is clipped, so only its first words are in the DOM.
      const row = page
        .locator('[data-sidebar-row]')
        .filter({ hasText: LONG_TASK.split(',')[0] ?? '' })
        .first()

      await row.waitFor({ timeout: 15_000 })
      const more = row.getByRole('button', { name: /^More actions for / })

      // The click moves the pointer onto the row first, which is what starts the
      // marquee; #3910 is this click landing on the title instead.
      await more.click({ timeout: 15_000 })
      await page.getByRole('menu').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
    },
  },
  {
    // #2530: a Task was reported missing from the list after an update, and no
    // scenario said which Tasks the list must show.
    name: 'the Tasks page lists a Task that is open in it',
    run: async (page) => {
      await page.getByRole('tab', { name: 'Tasks' }).click()
      const rows = page.locator('[data-sidebar-row]')

      await rows.first().waitFor({ timeout: 15_000 })
      const before = await rows.count()

      // Away and back: the list is rebuilt, which is when the report saw a Task go.
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await rows.first().waitFor({ timeout: 15_000 })
      must(
        (await rows.count()) >= before,
        `the Tasks page to keep listing its ${String(before)} Tasks`,
      )
    },
  },
]
