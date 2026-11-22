// The sidebar's Archived reads the archive afresh each time it opens (#4604).
import { randomUUID } from 'node:crypto'

import { rest } from './leave-helpers.ts'
import { artifacts } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const FIRST = 'E2E Task archived first'
const LATER = 'E2E Task archived on another device'

/** A Task archived through the API, as an agent or another device does: this window hears nothing. */
export async function archivedTask(stack: Stack, title: string, parentSessionId?: string) {
  const api = rest(stack, stack.token)
  const sessionId = randomUUID()

  await api('PUT', `/agent/conversations/${sessionId}/transcript`, {
    teamId: stack.teamId,
    title,
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
]
