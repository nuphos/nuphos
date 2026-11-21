// #3308: a Bot busy with work outside a group chat shows Busy among the chat's members, and a
// post to it there joins its running turn, so the chat shows its dots.
import { agentEvents } from '../agent-log.ts'
import { pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'
import { newTask, send } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

async function api(stack: Stack, method: string, path: string, body?: object) {
  const response = await fetch(`${stack.apiUrl}${path}?teamId=${stack.teamId}`, {
    method,
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify({ teamId: stack.teamId, ...body }) } : {}),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as {
    sessionId?: string
    conversations?: { sessionId: string; firstMessage?: string }[]
  }
}

export default {
  name: "a busy Bot reads Busy among a chat's members, and a post to it there joins its turn",
  run: async (page, stack) => {
    await newTask(page)
    // A new Task starts on the runtime picked last, which the scenarios before took away.
    await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
    await send(page, 'Keep working E2E_HOLD E2E_DELIVERY:busy-elsewhere')
    await until('the held turn to start', async () =>
      agentEvents(stack).includes('start E2E_DELIVERY:busy-elsewhere'),
    )
    const listed = (await api(stack, 'GET', '/agent/conversations')).conversations ?? []
    const busy = listed.find((row) => row.firstMessage?.includes('busy-elsewhere'))?.sessionId

    if (!busy) throw new Error('The held Task is not listed')
    try {
      await api(stack, 'POST', `/agent/conversations/${busy}/bot`)
      const chat = (
        await api(stack, 'POST', '/agent/channels', { title: 'E2E presence chat', group: true })
      ).sessionId

      await api(stack, 'POST', `/agent/conversations/${chat ?? ''}/agents`, { sessionId: busy })
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByText('E2E presence chat').first().click()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.getByRole('button', { name: 'Share' }).first().click()
      await page.getByText('Busy', { exact: true }).waitFor({ timeout: 30_000 })
      await page.screenshot({ path: `${artifacts}/presence-members-busy-light.png` })
      await page.keyboard.press('Escape')
      await api(stack, 'POST', `/agent/conversations/${chat ?? ''}/channel-messages`, {
        text: `Can you look at this? ${stack.apiUrl}/teams/${stack.teamId}/agent/${busy}`,
      })
      // The held Task's chat, kept hidden for a quick switch back, shows its dots too.
      await page.locator('.t-typing-dot:visible').first().waitFor({ timeout: 30_000 })
      await page.screenshot({ path: `${artifacts}/presence-busy-joins-turn-light.png` })
    } finally {
      await api(stack, 'POST', `/agent/conversations/${busy}/cancel-runtime`)
      await until('the held turn to stop', async () =>
        agentEvents(stack).includes('cancelled E2E_DELIVERY:busy-elsewhere'),
      )
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    }
  },
} satisfies Scenario
