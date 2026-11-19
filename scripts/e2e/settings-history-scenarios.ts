// #3699: every change of a conversation's model is recorded, whoever made it and from where.
import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Change = {
  via: string
  client?: string
  model?: { from?: { value: string }; to?: { value: string } }
}

export const settingsHistoryScenarios: Scenario[] = [
  {
    name: "a thread's model changed by update_thread and by the picker is recorded in the API and the conversation",
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Start a thread and change its model E2E_RETUNE E2E_DELIVERY:retune')
      await until('the parent to change its thread’s model', async () =>
        agentLog(stack).some((entry) => entry.event === 'retuned'),
      )
      const retuned = JSON.parse(
        agentLog(stack).find((entry) => entry.event === 'retuned')?.detail ?? '{}',
      ) as { threadId?: string; error?: unknown }

      if (!retuned.threadId || retuned.error)
        throw new Error(`update_thread did not change the model: ${JSON.stringify(retuned)}`)
      await page.getByText('ACK E2E_DELIVERY:retune', { exact: true }).waitFor()
      await page.getByTitle('Open “E2E retune”').first().click()
      await page.getByRole('button', { name: /^Model settings: fixture-small/ }).waitFor()
      // The person changes it back in the Desktop picker.
      await page
        .getByRole('button', { name: /^Model settings/ })
        .last()
        .click()
      await page.getByRole('button', { name: 'Select model' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'fixture', exact: true }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Model settings: fixture(?!-)/ }).waitFor()

      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${retuned.threadId}/settings-history?teamId=${stack.teamId}`,
        { headers: { authorization: `Bearer ${stack.token}` } },
      )
      const { changes } = (await response.json()) as { changes: Change[] }
      const byAgent = changes.find(
        (change) => change.via === 'update_thread' && change.model?.to?.value === 'fixture-small',
      )
      const byPicker = changes.find(
        (change) =>
          change.via === 'picker' &&
          change.client === 'desktop' &&
          change.model?.from?.value === 'fixture-small' &&
          change.model.to?.value === 'fixture',
      )

      if (!byAgent || !byPicker)
        throw new Error(`The settings history lacks a change: ${JSON.stringify(changes)}`)
      // Both show in the conversation, between its messages.
      await page.getByText(/ changed the model .*to fixture-small · update_thread$/).waitFor()
      await page.getByText(/ changed the model from fixture-small to fixture · Desktop$/).waitFor()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${artifacts}/settings-history-light.png` })
    },
  },
]
