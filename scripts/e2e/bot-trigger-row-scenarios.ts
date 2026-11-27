// A Trigger row in Edit Bot opens what the Trigger sends; its switch stays on its own.
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { newTask, send, setBotDetails } from './ui.ts'

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
    name: 'a Trigger row in Edit Bot opens its details, and its switch still works on its own',
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

      await call(stack, 'POST', '/agent/triggers', {
        targetSessionId: bot.sessionId,
        name: 'Deploy alerts',
        triggerType: 'webhook',
        messageTemplate: 'Check the deploy {{payload.id}}',
      })

      await page.getByRole('tab', { name: /^Bots/ }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'Digest Bot' }).first().click()
      await page.locator('[aria-placeholder="Message Digest Bot"]').waitFor()
      await setBotDetails(page, true)
      const details = page.getByRole('complementary', { name: 'Bot details' })

      // Bot details no longer lists Triggers: its owner finds them in Edit Bot's Advanced page.
      if ((await details.getByText('Daily digest').count()) > 0)
        throw new Error('Bot details still lists Triggers')
      const panel = page.getByRole('dialog', { name: 'Edit Bot' })
      const openAdvanced = async () => {
        await details.getByRole('button', { name: 'Edit Bot' }).click()
        await panel.getByRole('tab', { name: 'Advanced' }).click()
      }
      const row = panel.getByRole('button', { name: /Daily digest/ })
      const rowIs = (open: boolean) =>
        panel.locator(`button[aria-expanded="${String(open)}"]`, { hasText: 'Daily digest' })

      await openAdvanced()
      await rowIs(false).waitFor()
      // Captures for the PR are in the light theme.
      await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
      await page.waitForTimeout(600) // the dialog fades in; let it land
      await page.screenshot({ path: join(artifacts, 'bot-trigger-row-closed.png') })
      await row.click()
      await rowIs(true).waitFor()
      await panel.getByText('Summarise yesterday E2E_DELIVERY:bot-trigger-row').waitFor()
      await panel.getByText('Next runs, your time').waitFor()
      await page.screenshot({ path: join(artifacts, 'bot-trigger-row-open.png') })
      // Edit closes Edit Bot and starts a message to the Bot about this Trigger.
      await panel.getByRole('button', { name: 'Edit', exact: true }).click()
      await panel.waitFor({ state: 'detached' })
      const composer = page.locator('[aria-placeholder="Message Digest Bot"]')

      await until('Edit to fill the composer', async () =>
        (await composer.innerText()).includes('Edit your trigger “Daily digest”'),
      )
      await page.screenshot({ path: join(artifacts, 'bot-trigger-row-edit.png') })
      await openAdvanced()
      // A webhook Trigger has no next runs to list: its row opens to what it sends.
      await panel.getByRole('button', { name: /Deploy alerts/ }).click()
      await panel.getByText('Check the deploy {{payload.id}}').waitFor()
      await page.screenshot({ path: join(artifacts, 'bot-trigger-row-webhook.png') })
      await panel.getByRole('button', { name: /Deploy alerts/ }).click()

      // The switch pauses it at once, without Save, and leaves the row closed.
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
      await panel.getByRole('button', { name: 'Cancel' }).click()
      await panel.waitFor({ state: 'detached' })
      await setBotDetails(page, false)
    },
  },
  {
    // A Task's summary lists its Triggers too; with no Bot chat to write in, it says to ask.
    name: 'a Trigger row in a Task summary opens its details, without Edit',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of a Trigger E2E_DELIVERY:task-trigger-row')
      await page.getByText('ACK E2E_DELIVERY:task-trigger-row').waitFor()
      const search = encodeURIComponent('E2E_DELIVERY:task-trigger-row')
      const { conversations } = await call<{ conversations: { sessionId: string }[] }>(
        stack,
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&search=${search}`,
      )

      await call(stack, 'POST', '/agent/triggers', {
        targetSessionId: conversations[0]?.sessionId,
        name: 'Weekly report',
        triggerType: 'cron',
        cronExpression: '0 9 * * 1',
        messageTemplate: 'Write the weekly report',
      })
      const toggle = page.getByRole('button', { name: /task summary$/ }).first()
      const summary = page.getByLabel('Task summary', { exact: true })

      if (await summary.isVisible()) await toggle.click()
      await toggle.click()
      await summary.getByRole('button', { name: /Weekly report/ }).click()
      await summary.getByText('Ask here to change this trigger.').waitFor()
      if ((await summary.getByRole('button', { name: 'Edit', exact: true }).count()) > 0)
        throw new Error('A Task summary row offers Edit')
      await page.waitForTimeout(600)
      await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
      await page.screenshot({ path: join(artifacts, 'task-trigger-row-open.png') })
      await toggle.click()
    },
  },
]
