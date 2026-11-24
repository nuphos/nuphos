// #4304: a link to another chat shows what it opens, a Task's Runtime icon and title or a
// Bot's face and name, and reads Open when the sidebar has not listed it.
import { join } from 'node:path'

import { archivedTask } from './archive-popover-scenarios.ts'
import { artifacts } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

async function api<T>(stack: Stack, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(stack.apiUrl + path, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

  return (await response.json()) as T
}

/** An hourly Trigger that runs in `targetSessionId`. */
function trigger(stack: Stack, name: string, targetSessionId: string | undefined) {
  return api<{ id: string }>(stack, 'POST', '/agent/triggers', {
    teamId: stack.teamId,
    targetSessionId,
    name,
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: `Run ${name}`,
  })
}

/** Has the open chat's agent show the Trigger's card, and returns the card. */
async function showCard(page: Page, id: string, name: string, marker: string) {
  await send(page, `Show it E2E_TRIGGER_CARD:${id} E2E_DELIVERY:${marker}`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()

  return page.getByRole('region', { name: `Trigger ${name}` })
}

/** A new Task whose first message is `text`, in the light theme the PR's captures use. */
async function startTask(page: Page, text: string, marker: string) {
  await newTask(page)
  await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
  await send(page, `${text} E2E_DELIVERY:${marker}`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
}

export const triggerLinkScenarios: Scenario[] = [
  {
    name: "a Trigger card's link shows the Task or Bot it opens, and none in its own chat",
    expected: /"(?:provider_error_code|error_code)":"runtime_file_unavailable"/,
    run: async (page, stack) => {
      await startTask(page, 'Weekly metrics', 'link-home')
      const search = encodeURIComponent('E2E_DELIVERY:link-home')
      const { conversations } = await api<{ conversations: { sessionId: string }[] }>(
        stack,
        'GET',
        `/agent/conversations?teamId=${stack.teamId}&search=${search}`,
      )
      const here = await trigger(stack, 'Metrics digest', conversations[0]?.sessionId)
      const bot = await api<{ sessionId: string }>(stack, 'POST', '/agent/bots', {
        teamId: stack.teamId,
        title: 'Metrics Bot',
        avatar: '07-ada',
        agentRuntime: 'claude-code',
      })
      const forBot = await trigger(stack, 'Bot digest', bot.sessionId)
      const archived = await trigger(
        stack,
        'Archived digest',
        await archivedTask(stack, 'E2E archived metrics'),
      )

      // In the Task it runs in, the card has nowhere else to open.
      const own = await showCard(page, here.id, 'Metrics digest', 'link-card')

      await own.getByText('Next runs').first().waitFor()
      if ((await own.locator('footer').count()) !== 0)
        throw new Error('A Trigger card links back to the chat it is shown in')

      // A Bot's Trigger shows the Bot's face and name; the sidebar lists the Bot within its next poll.
      const botCard = await showCard(page, forBot.id, 'Bot digest', 'link-bot')

      await botCard.getByRole('link', { name: 'Metrics Bot', exact: true }).waitFor()
      if ((await botCard.locator('footer img').count()) !== 1)
        throw new Error("The Bot's link does not show its face")

      // An archived Task is not in the sidebar's list: Open.
      const archivedCard = await showCard(page, archived.id, 'Archived digest', 'link-archived')

      await archivedCard.getByRole('link', { name: 'Open', exact: true }).waitFor()
      await archivedCard.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'trigger-card-links-in-task.png') })

      // From another Task, the first Trigger shows the Task it runs in, with its Runtime icon.
      await startTask(page, 'Launch report', 'link-other')
      const taskCard = await showCard(page, here.id, 'Metrics digest', 'link-task')

      await taskCard.getByRole('link', { name: /^Weekly metrics/ }).waitFor()
      if ((await taskCard.locator('footer img').count()) !== 0)
        throw new Error("The Task's link shows a face, not its Runtime icon")
      await taskCard.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'trigger-card-link-to-task.png') })

      // A file Files cannot load offers the chat that linked it, named on its button: a Task.
      await send(page, 'Report E2E_FILE_LINK E2E_DELIVERY:link-file-task')
      await page.getByText('ACK E2E_DELIVERY:link-file-task').waitFor()
      await page.getByRole('link', { name: 'missing-report.md' }).last().click()
      await page.getByText('Could not load runtime files').waitFor()
      await page.getByRole('button', { name: /^Launch report/ }).waitFor()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'files-error-task-link.png') })
      await page.getByRole('button', { name: 'Close tab Files' }).click()

      // And from the Bot's chat, the Bot.
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
      await page.getByRole('button', { name: 'Metrics Bot', exact: true }).waitFor()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'files-error-bot-link.png') })
      await page.getByRole('button', { name: 'Close tab Files' }).click()
    },
  },
]
