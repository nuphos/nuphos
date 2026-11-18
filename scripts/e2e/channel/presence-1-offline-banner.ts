// Named to run after bot-settings: it moves the Bot between runtimes, which clears its model.
// #3308: a Bot whose computer is offline says so with the strip a Task shows above its composer:
// in its own chat, and, naming it, in a group chat it is in.
import { randomUUID } from 'node:crypto'

import {
  botPresence,
  computerWithUsage,
  isBotRow,
  listedConversations,
  pickRuntime,
} from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'
import { newTask } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

async function post(stack: Stack, path: string, body: object) {
  const response = await fetch(`${stack.apiUrl}${path}?teamId=${stack.teamId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: stack.teamId, ...body }),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as { sessionId?: string }
}

export default {
  name: "a Bot whose computer is offline says so above the composer, in its chat and a group's",
  run: async (page, stack) => {
    const computer = 'E2E away computer'
    const disconnect = await computerWithUsage(stack, computer, randomUUID())

    try {
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await pickRuntime(page, computer, /^Claude Code/)
      disconnect(false)
      await until('the Bot to read as offline', async () => {
        const presence = (await botPresence(stack)) as { reason?: string } | undefined

        return presence?.reason === 'computer_offline'
      })
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      const strip = page.getByText('Its computer is offline.', { exact: true })

      await strip.waitFor({ timeout: 60_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-banner-light.png` })
      // In a group chat the strip names the Bot whose computer is offline.
      const bot = (await listedConversations(stack)).find(
        (row) => row.title === 'E2E Bot' && isBotRow(row),
      ) as { sessionId?: string } | undefined
      const group = await post(stack, '/agent/channels', {
        title: 'E2E offline group',
        group: true,
      })

      await post(stack, `/agent/conversations/${group.sessionId ?? ''}/agents`, {
        sessionId: bot?.sessionId,
      })
      await page.getByText('E2E offline group').first().click()
      await page
        .getByText('E2E Bot’s computer is offline.', { exact: true })
        .waitFor({ timeout: 60_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-group-light.png` })
      // The same strip on a Task on that computer, for comparison.
      await newTask(page)
      await pickRuntime(page, computer, /^Claude Code/)
      await strip.waitFor({ timeout: 60_000 })
      await page.screenshot({ path: `${artifacts}/presence-offline-task-light.png` })
      // A new Task starts on the runtime picked last: leave it on one that runs.
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
    } finally {
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      disconnect()
    }
  },
} satisfies Scenario
