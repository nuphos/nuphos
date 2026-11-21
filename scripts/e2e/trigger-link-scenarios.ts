// #4301: a link to another chat says whether it opens a Task or a Bot.
import { join } from 'node:path'

import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

async function api<T>(stack: Stack, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(stack.apiUrl + path, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

  return (await response.json()) as T
}

export const triggerLinkScenarios: Scenario[] = [
  {
    name: "a Trigger card's link reads Open Task, or Open Bot for a Bot's Trigger",
    expected: /"(?:provider_error_code|error_code)":"runtime_file_unavailable"/,
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Weekly metrics E2E_DELIVERY:link-home')
      await page.getByText('ACK E2E_DELIVERY:link-home').waitFor()
      const search = encodeURIComponent('E2E_DELIVERY:link-home')
      const { conversations } = await api<{ conversations: { sessionId: string }[] }>(
        stack,
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&search=${search}`,
      )
      const trigger = await api<{ id: string }>(stack, 'POST', '/agent/triggers', {
        teamId: stack.teamId,
        targetSessionId: conversations[0]?.sessionId,
        name: 'Metrics digest',
        triggerType: 'cron',
        cronExpression: '0 * * * *',
        messageTemplate: 'Report the metrics',
      })

      // Captures for the PR are in the light theme.
      await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
      await send(page, `Show it E2E_TRIGGER_CARD:${trigger.id} E2E_DELIVERY:link-card`)
      await page.getByText('ACK E2E_DELIVERY:link-card').waitFor()
      const card = page.getByRole('region', { name: 'Trigger Metrics digest' })

      await card.getByRole('link', { name: 'Open Task' }).waitFor()

      // A Bot's Trigger, shown in the same Task.
      const bot = await api<{ sessionId: string }>(stack, 'POST', '/agent/bots', {
        teamId: stack.teamId,
        title: 'Metrics Bot',
        avatar: '07-ada',
        agentRuntime: 'claude-code',
      })
      const forBot = await api<{ id: string }>(stack, 'POST', '/agent/triggers', {
        teamId: stack.teamId,
        targetSessionId: bot.sessionId,
        name: 'Bot digest',
        triggerType: 'cron',
        cronExpression: '0 * * * *',
        messageTemplate: 'Report to the Bot',
      })

      await send(page, `And E2E_TRIGGER_CARD:${forBot.id} E2E_DELIVERY:link-bot`)
      await page.getByText('ACK E2E_DELIVERY:link-bot').waitFor()
      const botCard = page.getByRole('region', { name: 'Trigger Bot digest' })

      // The sidebar lists the new Bot within its next poll.
      await botCard.getByRole('link', { name: 'Open Bot' }).waitFor()
      await botCard.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'trigger-card-open-task-and-bot.png') })

      // A file Files cannot load offers the chat that linked it: here a Task.
      await send(page, 'Report E2E_FILE_LINK E2E_DELIVERY:link-file-task')
      await page.getByText('ACK E2E_DELIVERY:link-file-task').waitFor()
      await page.getByRole('link', { name: 'missing-report.md' }).last().click()
      const failed = page.getByText('Could not load runtime files')

      await failed.waitFor()
      await page.getByRole('button', { name: 'Open Task', exact: true }).waitFor()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'files-error-open-task.png') })
      await page.getByRole('button', { name: 'Close tab Files' }).click()

      // And from the Bot's own chat.
      await page.getByRole('tab', { name: /^Bots/ }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'Metrics Bot' }).first().click()
      await page.locator('[aria-placeholder="Message Metrics Bot"]').waitFor()
      await send(page, 'Report E2E_FILE_LINK E2E_DELIVERY:link-file-bot')
      // The Bot's sidebar row previews the same reply, so wait on the message itself.
      await page
        .getByRole('paragraph')
        .filter({ hasText: 'POSTED E2E_DELIVERY:link-file-bot' })
        .waitFor()
      await page.getByRole('link', { name: 'missing-report.md' }).last().click()
      await page.getByRole('button', { name: 'Open Bot', exact: true }).waitFor()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'files-error-open-bot.png') })
      await page.getByRole('button', { name: 'Close tab Files' }).click()
    },
  },
]
