// A post steered into a Bot's running turn reaches it once, even when the agent acknowledges
// the steer only after OpenAB stopped waiting for it ("delivery is unknown").
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentEvents, agentLog } from '../agent-log.ts'
import { pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'
import { newTask, send } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'

const MARKER = 'E2E_DELIVERY:slow-steer-post'

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

/** Each time the post reached the agent: steered into a turn, or a turn of its own. */
const deliveries = (stack: Stack, sessionId: string) =>
  agentLog(stack).filter(
    (entry) =>
      entry.sessionId === sessionId &&
      (entry.event === 'steered' || entry.event === 'start') &&
      entry.markers?.includes(MARKER),
  )

export default {
  name: 'a post steered into a turn that acknowledges late reaches the Bot once',
  run: async (page, stack) => {
    const slowSteer = join(artifacts, 'slow-steer')

    // Only the session opened below takes steers.
    writeFileSync(slowSteer, '')
    let busy: string | undefined

    try {
      await newTask(page)
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      await send(page, 'Keep working E2E_HOLD E2E_DELIVERY:slow-steer-turn')
      await until('the held turn to start', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:slow-steer-turn'),
      )
      const listed = (await api(stack, 'GET', '/agent/conversations')).conversations ?? []

      busy = listed.find((row) => row.firstMessage?.includes('slow-steer-turn'))?.sessionId
      if (!busy) throw new Error('The held Task is not listed')
      await api(stack, 'POST', `/agent/conversations/${busy}/bot`)
      const chat = (
        await api(stack, 'POST', '/agent/channels', { title: 'E2E slow steer chat', group: true })
      ).sessionId

      await api(stack, 'POST', `/agent/conversations/${chat ?? ''}/agents`, { sessionId: busy })
      await api(stack, 'POST', `/agent/conversations/${chat ?? ''}/channel-messages`, {
        text: `Can you look at this? ${MARKER} ${stack.apiUrl}/teams/${stack.teamId}/agent/${busy}`,
      })
      const id = busy

      await until('the post to be steered into the turn', async () =>
        agentLog(stack).some((entry) => entry.sessionId === id && entry.event === 'steered'),
      )
      // Long enough for a steer taken as failed to be retried twice.
      await page.waitForTimeout(30_000)
    } finally {
      rmSync(slowSteer, { force: true })
      if (busy) {
        await api(stack, 'POST', `/agent/conversations/${busy}/cancel-runtime`)
        await until('the held turn to stop', async () =>
          agentEvents(stack).includes('cancelled E2E_DELIVERY:slow-steer-turn'),
        )
      }
    }
    // A notice still queued would start its own turn once the held one ends.
    await page.waitForTimeout(10_000)
    const got = deliveries(stack, busy ?? '')

    if (got.length !== 1)
      throw new Error(
        `The post reached the Bot ${String(got.length)} times: ${got.map((e) => e.event).join(', ')}`,
      )
    await page.getByRole('tab', { name: 'Bots' }).click()
    await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
  },
} satisfies Scenario
