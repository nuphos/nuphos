// Scenarios about a Task's scheduled Triggers.
import { join } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Trigger = { id: string; enabled: boolean; executionAuthorizationError?: string }

function client(stack: Stack) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(stack.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (!response.ok) throw new Error(`${method} ${path} answered ${String(response.status)}`)

    return (await response.json()) as T
  }
}

/** The Task whose first message carries `marker`. */
async function taskWith(stack: Stack, marker: string): Promise<string> {
  const api = client(stack)
  const search = encodeURIComponent(marker)
  const { conversations } = await api<{ conversations: { sessionId: string }[] }>(
    'GET',
    `/agent/conversations?teamId=${stack.teamId}&search=${search}`,
  )
  const sessionId = conversations[0]?.sessionId

  if (!sessionId) throw new Error(`No Task starts with ${marker}`)

  return sessionId
}

/** Presses Run now `times` times, each after the fire before failed at the agent; returns the Trigger. */
async function fireFailing(stack: Stack, trigger: Trigger, marker: string, times: number) {
  const api = client(stack)
  const started = () => agentEvents(stack).filter((event) => event === `start ${marker}`).length
  const before = started()

  for (let fire = 1; fire <= times; fire++) {
    await api('POST', `/agent/triggers/${trigger.id}/test-fire?teamId=${stack.teamId}`)
    await until(`fire ${String(fire)} to reach the agent`, async () => started() === before + fire)
    // The turn is over once nothing holds the Task: its failure has been recorded.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }

  return api<Trigger>('GET', `/agent/triggers/${trigger.id}?teamId=${stack.teamId}`)
}

async function createTrigger(stack: Stack, sessionId: string, name: string, message: string) {
  return client(stack)<Trigger>('POST', '/agent/triggers', {
    teamId: stack.teamId,
    targetSessionId: sessionId,
    name,
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: message,
  })
}

export const triggerScenarios: Scenario[] = [
  {
    // #3160: a Trigger whose turns could never succeed kept firing, and its owner was never told.
    name: 'a Trigger that keeps failing for a lasting reason pauses and says why; a passing one keeps running',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of the Triggers E2E_DELIVERY:trigger-home')
      await page.getByText('ACK E2E_DELIVERY:trigger-home').waitFor()
      const sessionId = await taskWith(stack, 'E2E_DELIVERY:trigger-home')

      // Out of usage passes with time: however often it fails, the Trigger keeps its schedule.
      const usage = await createTrigger(
        stack,
        sessionId,
        'Usage report',
        'Report E2E_USAGE_LIMIT E2E_DELIVERY:trigger-usage',
      )
      const stillOn = await fireFailing(stack, usage, 'E2E_DELIVERY:trigger-usage', 4)

      console.log(`Out of usage 4 times: ${JSON.stringify(stillOn)}`)
      if (!stillOn.enabled || stillOn.executionAuthorizationError)
        throw new Error(`Out of usage paused the Trigger: ${JSON.stringify(stillOn)}`)

      // Too long for the model cannot pass: the third failure in a row pauses it.
      const tooLong = await createTrigger(
        stack,
        sessionId,
        'Hourly report',
        'Report E2E_TOO_LONG E2E_DELIVERY:trigger-too-long',
      )
      const twice = await fireFailing(stack, tooLong, 'E2E_DELIVERY:trigger-too-long', 2)

      if (!twice.enabled) throw new Error('Two failures in a row paused the Trigger')
      const paused = await fireFailing(stack, tooLong, 'E2E_DELIVERY:trigger-too-long', 1)

      console.log(`Too long 3 times: ${JSON.stringify(paused)}`)
      const notice =
        'Paused after 3 runs in a row failed. This conversation is too long for the model. Start a new Task, or switch to a model with a larger context. Then turn the Trigger back on.'

      if (paused.enabled || paused.executionAuthorizationError !== notice)
        throw new Error(`The Trigger was not paused with its reason: ${JSON.stringify(paused)}`)

      // Its owner reads why, in plain words, in the Task's own Triggers.
      // Opened after the pause, so its list is read fresh.
      const toggle = page.getByRole('button', { name: /task summary$/ }).first()
      const summary = page.getByLabel('Agent summary')

      if (await summary.isVisible()) await toggle.click()
      await toggle.click()
      await summary.getByText(notice).waitFor()
      // The panel slides in; shoot it once it has settled.
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: join(artifacts, 'trigger-paused.png') })
      await toggle.click()
    },
  },
]
