// The sidebar's Archived reads the archive afresh each time it opens (#4604), and lists
// what Tasks would have: a Bot's work stays with the Bot (#4605).
import { randomUUID } from 'node:crypto'

import { rest } from './leave-helpers.ts'
import { artifacts } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const FIRST = 'E2E Task archived first'
const LATER = 'E2E Task archived on another device'
const MINE = 'E2E my archived Task'
const BOTS = "E2E the Bot's archived Task"

/** A Task imported and archived through the API, as another device does: this window hears nothing. */
export async function archivedTask(stack: Stack, title: string, parentSessionId?: string) {
  const api = rest(stack, stack.token)
  const sessionId = randomUUID()

  // A conversation is stored only with its runtime (#4614): seed it as an imported local session.
  await api('PUT', `/agent/conversations/${sessionId}/transcript`, {
    teamId: stack.teamId,
    title,
    agentRuntime: 'claude-code',
    import: true,
    messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: title }] }],
  })
  if (parentSessionId)
    await api('PUT', `/agent/conversations/${sessionId}/parent`, {
      teamId: stack.teamId,
      parentSessionId,
    })
  await api('PATCH', `/agent/conversations/${sessionId}/archive`, {
    teamId: stack.teamId,
    archived: true,
  })

  return sessionId
}

/** Opens the sidebar's Archived and waits for its list to show `title`. */
export async function openArchived(page: Page, title: string) {
  const popover = page.locator('.sidebar-archive-overlay')

  await page.getByRole('button', { name: 'Archived', exact: true }).click()
  await popover.getByText(title, { exact: true }).waitFor({ timeout: 15_000 })

  return popover
}

export async function closeArchived(page: Page) {
  await page.keyboard.press('Escape')
  await page.locator('.sidebar-archive-overlay').waitFor({ state: 'detached' })
}

export const archivePopoverScenarios: Scenario[] = [
  {
    name: 'Archived lists a Task archived elsewhere the next time it opens',
    run: async (page, stack) => {
      await archivedTask(stack, FIRST)
      await page.reload()
      // Captures for the PR are in the light theme.
      await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
      await openArchived(page, FIRST)
      await closeArchived(page)
      // The window stays open; the archive changes behind it.
      await archivedTask(stack, LATER)
      await openArchived(page, LATER)
      await page.screenshot({ path: `${artifacts}/archive-popover-reloaded.png` })
      await closeArchived(page)
    },
  },
  {
    name: 'Archived leaves out the Tasks a Bot dispatched, in the popover and on the full page',
    run: async (page, stack) => {
      const bot = await rest(stack, stack.token)<{ sessionId: string }>('POST', '/agent/bots', {
        teamId: stack.teamId,
        title: 'Archive Bot',
        avatar: '07-ada',
        agentRuntime: 'claude-code',
      })

      await archivedTask(stack, BOTS, bot.sessionId)
      await archivedTask(stack, MINE)
      await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
      const popover = await openArchived(page, MINE)

      // Both came in the same page of the archive, so the Bot's Task is left out, not late.
      if ((await popover.getByText(BOTS, { exact: true }).count()) > 0)
        throw new Error("the popover lists the Bot's Task")
      await page.screenshot({ path: `${artifacts}/archive-popover-bot-work.png` })
      await popover.getByRole('button', { name: 'View all' }).click()
      await closeArchived(page)
      await page.getByText(MINE, { exact: true }).waitFor({ timeout: 15_000 })
      if ((await page.getByText(BOTS, { exact: true }).count()) > 0)
        throw new Error("the Archived page lists the Bot's Task")
      await page.screenshot({ path: `${artifacts}/archived-page-bot-work.png` })
    },
  },
]
