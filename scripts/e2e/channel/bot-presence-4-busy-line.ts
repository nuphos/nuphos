// #3308: a post to a Bot busy with work outside its chat says it will reply when that is done.
import { agentEvents } from '../agent-log.ts'
import { artifacts, until } from '../processes.ts'
import { newTask, send } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

async function api(stack: Stack, method: string, path: string) {
  const response = await fetch(`${stack.apiUrl}${path}?teamId=${stack.teamId}`, {
    method,
    headers: { authorization: `Bearer ${stack.token}` },
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as {
    conversations?: { sessionId: string; firstMessage?: string }[]
  }
}

export default {
  name: 'a post to a Bot busy outside its chat says it will reply when that is done',
  run: async (page, stack) => {
    await newTask(page)
    await send(page, 'Keep working E2E_HOLD E2E_DELIVERY:busy-elsewhere')
    await until('the held turn to start', async () =>
      agentEvents(stack).includes('start E2E_DELIVERY:busy-elsewhere'),
    )
    const listed = (await api(stack, 'GET', '/agent/conversations')).conversations ?? []
    const busy = listed.find((row) => row.firstMessage?.includes('busy-elsewhere'))

    if (!busy) throw new Error('The held Task is not listed')
    try {
      await api(stack, 'POST', `/agent/conversations/${busy.sessionId}/bot`)
      await page.getByRole('tab', { name: 'Bots' }).click()
      const rows = page.locator('[data-sidebar-row]')

      await rows.filter({ hasText: 'E2E_DELIVERY:busy-elsewhere' }).first().click()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await send(page, 'Are you free? E2E_DELIVERY:busy-asked')
      await page
        .getByText(/is working outside this chat\. It will reply when that’s done\./)
        .waitFor({
          timeout: 30_000,
        })
      await page.screenshot({ path: `${artifacts}/presence-busy-line-light.png` })
    } finally {
      await api(stack, 'POST', `/agent/conversations/${busy.sessionId}/cancel-runtime`)
      await until('the held turn to stop', async () =>
        agentEvents(stack).includes('cancelled E2E_DELIVERY:busy-elsewhere'),
      )
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    }
  },
} satisfies Scenario
