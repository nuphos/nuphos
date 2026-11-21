// #4427: a turn's origin no longer decides what it may do; a live turn is what an Instruction
// write needs, whatever woke it.
import { agentLog } from './agent-log.ts'
import { until } from './processes.ts'
import { createWebhook, deliver, taskWith } from './trigger-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const instructionScenarios: Scenario[] = [
  {
    name: 'a webhook-woken turn writes an Instruction, and the same write after the turn is refused',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of the instruction E2E_DELIVERY:instruction-home')
      await page.getByText('ACK E2E_DELIVERY:instruction-home').waitFor()
      const sessionId = await taskWith(stack, 'E2E_DELIVERY:instruction-home')
      const hook = await createWebhook(stack, sessionId, 'Instruction alerts')
      const alert = await deliver(stack, hook, {
        state: 'firing',
        hold: 'E2E_INSTRUCTION',
        id: 'instruction-alert',
      })

      if (alert.status !== 200 || !alert.body.ok)
        throw new Error(`The alert was not accepted: ${JSON.stringify(alert)}`)
      const writes = () =>
        agentLog(stack).filter(
          (entry) => entry.event === 'instruction' && entry.sessionId && entry.name,
        )

      await until('the write after the turn', async () =>
        writes().some((entry) => entry.name === 'idle') ? true : undefined,
      )
      const [live, idle] = ['live', 'idle'].map(
        (name) =>
          writes().find((entry) => entry.name === name)?.result as {
            status: number
            id?: string
            code?: string
          },
      )

      console.log(`Instruction writes: ${JSON.stringify({ live, idle })}`)
      if (live?.status !== 201 || !live.id)
        throw new Error(`The webhook-woken turn could not write: ${JSON.stringify(live)}`)
      if (idle?.status !== 403 || idle.code !== 'instructions_active_turn_required')
        throw new Error(`The write after the turn was not refused: ${JSON.stringify(idle)}`)
      // Later scenarios' prompts would carry it.
      await fetch(`${stack.apiUrl}/teams/${stack.teamId}/instructions/${live.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${stack.token}` },
      })
    },
  },
]
