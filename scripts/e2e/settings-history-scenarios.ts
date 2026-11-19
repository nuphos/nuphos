// #3699: every change of a conversation's model is recorded, whoever made it and from where,
// and shows as one line among the messages.
import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

type Change = {
  via: string
  client?: string
  actor: { type: string }
  model?: { from?: { value: string }; to?: { value: string } }
}

// A long first message gives the parent Task a long title, which its line cuts short.
const PROMPT =
  'Write the release notes for the November desktop and mobile apps E2E_RETUNE E2E_DELIVERY:retune'

/** The timeline line that reads `text`. */
const line = (page: Page, text: RegExp) => page.locator('div[title]').filter({ hasText: text })

async function openChip(page: Page) {
  await page
    .getByRole('button', { name: /^Model settings/ })
    .last()
    .click()
}

/** Both themes, at the window's width and at a narrow one. */
async function capture(page: Page, name: string) {
  const cdp = await page.context().newCDPSession(page)

  try {
    for (const width of [0, 720]) {
      if (width) {
        const height = await page.evaluate(() => window.innerHeight)

        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: 0,
          mobile: false,
        })
      }
      for (const theme of ['light', 'dark']) {
        await page.evaluate((next) => {
          document.documentElement.classList.remove('light', 'dark')
          document.documentElement.classList.add(next)
        }, theme)
        await page.waitForTimeout(500)
        await page.screenshot({
          path: `${artifacts}/${name}${width ? '-narrow' : ''}-${theme}.png`,
        })
      }
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await cdp.detach()
  }
}

export const settingsHistoryScenarios: Scenario[] = [
  {
    name: "a thread's model changed by update_thread, the picker and a move is recorded in the API and the conversation",
    run: async (page, stack) => {
      // The first agent offers effort levels.
      const stopOffering = stack.offerDefaultStandIn()
      const theme = await page.evaluate(() => document.documentElement.className)

      try {
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
        await send(page, PROMPT)
        await until('the parent to change its thread’s model', async () =>
          agentLog(stack).some((entry) => entry.event === 'retuned'),
        )
        const retuned = JSON.parse(
          agentLog(stack).find((entry) => entry.event === 'retuned')?.detail ?? '{}',
        ) as { threadId?: string; error?: unknown }

        if (!retuned.threadId || retuned.error)
          throw new Error(`update_thread did not change the model: ${JSON.stringify(retuned)}`)
        await page.getByText('ACK E2E_DELIVERY:retune', { exact: true }).waitFor()
        // A new Task shows no line for what its agent filled in.
        if (await line(page, / set /).count())
          throw new Error('A new Task showed what its agent filled in')
        await capture(page, 'settings-history-new-task')

        await page.getByTitle('Open “E2E retune”').first().click()
        await page.getByRole('button', { name: /^Model settings: fixture-small/ }).waitFor()
        // A Task's change names the Task, not the tool it used.
        await line(page, /\(a Task\)\s*changed the model .*to\s*fixture-small/).waitFor()

        // The person picks a model only this agent offers and the highest effort, in one go.
        await openChip(page)
        await page.getByRole('button', { name: 'Select model' }).click()
        await page.getByRole('menuitemcheckbox', { name: 'fixture-large', exact: true }).click()
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: /^Model settings: fixture-large/ }).waitFor()
        await openChip(page)
        await page.getByRole('slider').press('End')
        await page.waitForTimeout(500)
        await page.keyboard.press('Escape')
        await line(page, /changed the model to\s*fixture-large\s*and effort to\s*High/).waitFor()

        await send(page, 'Next, fast mode E2E_DELIVERY:retune-fast')
        await page.getByText('ACK E2E_DELIVERY:retune-fast', { exact: true }).waitFor()
        await openChip(page)
        await page.getByRole('button', { name: 'Turn on fast mode' }).click()
        await page.keyboard.press('Escape')
        await line(page, /turned fast mode on/).waitFor()

        // A move to an agent without that model: what the new agent picks goes on the move's line.
        // The model card closes first; its menu still animates out.
        await page.waitForTimeout(1_000)
        await pickAgent(page, 'E2E second agent')
        await page.getByText('moved this task from E2E fixture agent to E2E second agent').waitFor()
        await send(page, 'After the move E2E_DELIVERY:retune-moved')
        await page.getByText('ACK E2E_DELIVERY:retune-moved', { exact: true }).waitFor()
        await line(
          page,
          /moved this task from E2E fixture agent to E2E second agent\s*·\s*fixture/,
        ).waitFor()

        const response = await fetch(
          `${stack.apiUrl}/agent/conversations/${retuned.threadId}/settings-history?teamId=${stack.teamId}`,
          { headers: { authorization: `Bearer ${stack.token}` } },
        )
        const { changes } = (await response.json()) as { changes: Change[] }
        // A thread starts on its parent's model: when that is already fixture-small, the
        // parent's change is the one it made opening the thread, and update_thread changes nothing.
        const byAgent = changes.find(
          (change) =>
            change.actor.type === 'agent' &&
            ['create_thread', 'update_thread'].includes(change.via) &&
            change.model?.to?.value === 'fixture-small',
        )
        const byPicker = changes.find(
          (change) =>
            change.via === 'picker' &&
            change.client === 'desktop' &&
            change.model?.from?.value === 'fixture-small' &&
            change.model.to?.value === 'fixture-large',
        )

        if (!byAgent || !byPicker)
          throw new Error(`The settings history lacks a change: ${JSON.stringify(changes)}`)
        await capture(page, 'settings-history')
        // A new Task starts on the agent last used, and the scenarios after this one expect the first.
        await pickAgent(page, 'E2E fixture agent')
        await page.getByText('moved this task from E2E second agent to E2E fixture agent').waitFor()
      } finally {
        stopOffering()
        await page.evaluate((previous) => {
          document.documentElement.className = previous
        }, theme)
      }
    },
  },
]
