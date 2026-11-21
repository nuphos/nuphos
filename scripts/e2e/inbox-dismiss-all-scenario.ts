// "Dismiss all" in the Inbox, through the real routes: Cancel keeps every question, else each asker is told.
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

/** Opens "Dismiss all", checks it counts the two questions the Inbox shows, and confirms or cancels. */
async function dismissAll(page: Page, button: 'Dismiss all' | 'Cancel', shot?: string) {
  await page.getByRole('button', { name: 'Dismiss all', exact: true }).click()
  const dialog = page.getByRole('alertdialog')

  await dialog.getByText('Dismiss 2 questions?').waitFor()
  await dialog.getByText("Each Bot or Task that asked is told you won't answer.").waitFor()
  if (shot) await page.screenshot({ path: `${artifacts}/${shot}` })
  await dialog.getByRole('button', { name: button, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

export const inboxDismissAllScenario: Scenario = {
  name: 'dismiss all the questions shown in the Inbox: Cancel keeps them open, else each asker is told',
  run: async (page, stack) => {
    const owner = client(stack.apiUrl, stack.token)
    const open = async () => {
      const listed = await owner(
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&pendingDecision=true`,
      )

      return MARKERS.map(
        (marker) =>
          (listed.body as Listed).conversations.find((row) => row.firstMessage?.includes(marker))
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
    const [first] = await open()

    await page.getByRole('tab', { name: 'Inbox' }).click()
    await page.locator(`[data-inbox-question="${first}"]`).click()
    // Other scenarios' questions may still be open; the search keeps "Dismiss all" to these two.
    await page.getByRole('textbox', { name: 'Filter' }).fill('dismiss-all')
    await light(page)
    await page.getByRole('button', { name: 'Dismiss all', exact: true }).waitFor()
    await page.screenshot({ path: `${artifacts}/inbox-dismiss-all-light.png` })

    // Cancelled, nothing is sent: both stay open and neither asker is told.
    await dismissAll(page, 'Cancel', 'inbox-dismiss-all-confirm-light.png')
    must((await open()).every(Boolean), 'both questions to stay open after Cancel')
    must(told() === 0, `no asker to be told after Cancel, ${String(told())} were`)

    await dismissAll(page, 'Dismiss all')
    await until('both askers to be told', async () => told() === 2)
    await until('both questions to close', async () => (await open()).every((id) => !id))
    await page.screenshot({ path: `${artifacts}/inbox-dismiss-all-done-light.png` })
    await page.getByRole('textbox', { name: 'Filter' }).fill('')
  },
}
