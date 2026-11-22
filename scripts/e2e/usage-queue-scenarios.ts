// An agent out of usage keeps the queue it cannot run, rather than failing it message by message.
import { agentLog } from './agent-log.ts'
import { until } from './processes.ts'
import { client, createTrigger, taskWith } from './trigger-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Trigger } from './trigger-scenarios.ts'
import type { Scenario } from './ui.ts'

export const usageQueueScenarios: Scenario[] = [
  {
    // #4163: an agent out of usage failed the Task's queued messages one by one, dropping them all.
    name: 'an agent out of usage keeps the queued fires, and they run once the Task moves to another agent',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of the waiting fires E2E_DELIVERY:usage-home')
      await page.getByText('ACK E2E_DELIVERY:usage-home').waitFor()
      const sessionId = await taskWith(stack, 'E2E_DELIVERY:usage-home')
      const api = client(stack)
      const markers = ['usage-1', 'usage-2', 'usage-3'].map((m) => `E2E_DELIVERY:${m}`)
      const triggers: Trigger[] = []

      for (const marker of markers)
        triggers.push(
          await createTrigger(stack, sessionId, marker, `Report E2E_USAGE_LIMIT ${marker}`),
        )
      for (const trigger of triggers)
        await api('POST', `/agent/triggers/${trigger.id}/test-fire?teamId=${stack.teamId}`)
      const turns = (agent: string, event: string) =>
        agentLog(stack).filter(
          (entry) =>
            entry.agent === agent &&
            entry.event === event &&
            markers.some((marker) => entry.markers?.includes(marker) ?? entry.marker === marker),
        )

      // The first agent is out of usage: a few quick tries, then the queue waits it out.
      await until(
        'the first agent to refuse three tries',
        async () => turns('first', 'start').length >= 3,
      )
      await new Promise((resolve) => setTimeout(resolve, 6_000))
      const detail = () =>
        api<{ messages: unknown[] }>(
          'GET',
          `/agent/conversations/${sessionId}?teamId=${stack.teamId}`,
        )
      const before = JSON.stringify((await detail()).messages)

      console.log(
        `Out of usage: ${String(turns('first', 'start').length)} tries on the first agent`,
      )
      if (turns('first', 'start').length > 4)
        throw new Error('The queue kept trying an agent out of usage')
      // Waiting fires show as queued; none may be recorded as a failed turn.
      if (/turn-interrupted|usage limit/.test(before))
        throw new Error('A fire refused for usage was recorded as failed instead of kept waiting')

      // Moved to an agent with usage left: every fire runs there.
      const { runtimes } = await api<{ runtimes: { id: string; label: string }[] }>(
        'GET',
        `/teams/${stack.teamId}/agent-runtimes`,
      )
      const second = runtimes.find((runtime) => runtime.label === 'E2E second agent')?.id

      if (!second) throw new Error('E2E second agent is not listed')
      await api('POST', `/agent/conversations/${sessionId}/runtime`, {
        runtimeId: second,
        teamId: stack.teamId,
      })
      await until('every fire to run on the second agent', async () => {
        const ran = turns('second', 'start').flatMap((entry) => entry.markers ?? [])

        return markers.every((marker) => ran.includes(marker))
      })
      await until('the fires to be answered', async () => {
        const after = JSON.stringify((await detail()).messages)

        return after.includes('ACK E2E_DELIVERY:usage-') && turns('second', 'finish').length > 0
      })
      for (const trigger of triggers) {
        const now = await api<Trigger>(
          'GET',
          `/agent/triggers/${trigger.id}?teamId=${stack.teamId}`,
        )

        if (!now.enabled || now.executionAuthorizationError)
          throw new Error(`Out of usage paused the Trigger: ${JSON.stringify(now)}`)
      }
    },
  },
]
