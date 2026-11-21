// #4301: the Trigger card's link says whether it opens a Task or a Bot.
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
    },
  },
]
