// A Trigger row in a Bot's details opens what the Trigger sends; its switch stays on its own.
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { setBotDetails } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

async function call<T>(stack: Stack, method: string, path: string, body?: object): Promise<T> {
  const response = await fetch(stack.apiUrl + path, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify({ teamId: stack.teamId, ...body }) } : {}),
  })

  if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

  return (await response.json()) as T
}

export const botTriggerRowScenarios: Scenario[] = [
  {
    name: 'a Trigger row in Bot details opens its details, and its switch still works on its own',
    run: async (page, stack) => {
      const bot = await call<{ sessionId: string }>(stack, 'POST', '/agent/bots', {
        title: 'Digest Bot',
        avatar: '07-ada',
        agentRuntime: 'claude-code',
      })
      const trigger = await call<{ id: string }>(stack, 'POST', '/agent/triggers', {
        targetSessionId: bot.sessionId,
        name: 'Daily digest',
        triggerType: 'cron',
        cronExpression: '0 * * * *',
        messageTemplate: 'Summarise yesterday E2E_DELIVERY:bot-trigger-row',
      })

      await page.getByRole('tab', { name: /^Bots/ }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'Digest Bot' }).first().click()
      await page.locator('[aria-placeholder="Message Digest Bot"]').waitFor()
      await setBotDetails(page, true)
      const panel = page.getByRole('complementary', { name: 'Bot details' })
      const row = panel.getByRole('button', { name: /Daily digest/ })
      const rowIs = (open: boolean) =>
        panel.locator(`button[aria-expanded="${String(open)}"]`, { hasText: 'Daily digest' })

      await row.click()
      await rowIs(true).waitFor()
      await panel.getByText('Summarise yesterday E2E_DELIVERY:bot-trigger-row').waitFor()
      await panel.getByText('Next runs, your time').waitFor()
      await page.screenshot({ path: join(artifacts, 'bot-trigger-row-open.png') })
      // Edit starts a message to the Bot about this Trigger, as creating one did.
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      const composer = page.locator('[aria-placeholder="Message Digest Bot"]')

      await until('Edit to fill the composer', async () =>
        (await composer.innerText()).includes('Edit your trigger “Daily digest”'),
      )
      await row.click()
      await rowIs(false).waitFor()

      // The switch pauses it, saved, and leaves the row closed.
      await panel.getByRole('switch', { name: 'Enable Daily digest' }).click()
      await until('the switch to pause the Trigger', async () => {
        const saved = await call<{ enabled: boolean }>(
          stack,
          'GET',
          `/agent/triggers/${trigger.id}?teamId=${stack.teamId}`,
        )

        return !saved.enabled
      })
      if ((await rowIs(true).count()) > 0) throw new Error('The switch opened the row')
      await setBotDetails(page, false)
    },
  },
]
