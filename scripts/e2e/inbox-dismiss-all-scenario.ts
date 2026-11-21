// "Dismiss all" in the sidebar's Inbox header, through the real routes: Cancel keeps every question, else each asker is told.
import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Listed = {
  conversations: { sessionId: string; firstMessage?: string; inputRequests?: { id: string }[] }[]
}

const MARKERS = ['E2E_DELIVERY:dismiss-all-a', 'E2E_DELIVERY:dismiss-all-b']

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

/** The questions the sidebar's Inbox list shows, by id. */
const listed = (page: Page) =>
  page
    .locator('[data-inbox-question]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-inbox-question') ?? '').sort())

/** Opens the sidebar's "Dismiss all" and checks its dialog says `title`. */
async function openDismissAll(page: Page, title: string, shot?: string) {
  await page.getByRole('button', { name: 'Dismiss all', exact: true }).click()
  const dialog = page.getByRole('alertdialog')

  await dialog.getByText(title, { exact: true }).waitFor()
  await dialog.getByText("Each Bot or Task that asked is told you won't answer.").waitFor()
  if (shot) await page.screenshot({ path: `${artifacts}/${shot}` })

  return dialog
}

/** With the search on, "Dismiss all" names the two matches the sidebar lists, then `button` answers it. */
async function dismissMatches(page: Page, button: 'Dismiss all' | 'Cancel', shot?: string) {
  const dialog = await openDismissAll(page, 'Dismiss 2 matching questions?', shot)

  await dialog.getByRole('button', { name: button, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

export const inboxDismissAllScenario: Scenario = {
  name: 'dismiss all the questions the sidebar lists: Cancel keeps them open, else each asker is told',
  run: async (page, stack) => {
    const owner = client(stack.apiUrl, stack.token)
    const open = async () => {
      const response = await owner(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
      )

      return MARKERS.map(
        (marker) =>
          (response.body as Listed).conversations.find((row) => row.firstMessage?.includes(marker))
            ?.inputRequests?.[0]?.id,
      )
    }
    const sessions = () =>
      MARKERS.map(
        (marker) =>
          agentLog(stack).find((entry) => entry.marker === marker && entry.event === 'start')
            ?.sessionId,
      )
    const told = () =>
      sessions().filter((id) =>
        agentLog(stack).some((entry) => entry.sessionId === id && entry.event === 'dismissed'),
      ).length

    for (const marker of MARKERS) {
      await newTask(page)
      await send(page, `Ask me E2E_ASK ${marker}`)
      await page.getByText(`ACK ${marker}`).waitFor()
    }
    await until('both questions to be listed', async () => (await open()).every(Boolean))
    const ids = (await open()) as string[]

    await page.getByRole('tab', { name: 'Inbox' }).click()
    await page.locator(`[data-inbox-question="${ids[0]}"]`).click()
    await light(page)
    await page.getByRole('button', { name: 'Dismiss all', exact: true }).waitFor()
    await page.screenshot({ path: `${artifacts}/inbox-dismiss-all-sidebar-light.png` })

    // Without a search it names every question listed, here with other scenarios' still open.
    const all = (await listed(page)).length
    const plain = await openDismissAll(
      page,
      `Dismiss ${String(all)} questions?`,
      'inbox-dismiss-all-confirm-all-light.png',
    )

    await plain.getByRole('button', { name: 'Cancel', exact: true }).click()
    await plain.waitFor({ state: 'hidden' })

    // The search narrows the sidebar's list to its two matches, and "Dismiss all" to them.
    await page.getByRole('textbox', { name: 'Filter' }).fill('dismiss-all')
    await until('the sidebar to list only the two matches', async () => {
      const shown = await listed(page)

      return JSON.stringify(shown) === JSON.stringify([...ids].sort())
    })
    await page.screenshot({ path: `${artifacts}/inbox-dismiss-all-search-light.png` })

    // Cancelled, nothing is sent: both stay open and neither asker is told.
    await dismissMatches(page, 'Cancel', 'inbox-dismiss-all-confirm-light.png')
    must((await open()).every(Boolean), 'both questions to stay open after Cancel')
    must(told() === 0, `no asker to be told after Cancel, ${String(told())} were`)

    await dismissMatches(page, 'Dismiss all')
    await until('both askers to be told', async () => told() === 2)
    await until('both questions to close', async () => (await open()).every((id) => !id))
    await page.screenshot({ path: `${artifacts}/inbox-dismiss-all-done-light.png` })
    await page.getByRole('textbox', { name: 'Filter' }).fill('')
  },
}
