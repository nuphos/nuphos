// Scenarios about a Task's Triggers: scheduled, and webhooks a monitoring sender calls.
import { join } from 'node:path'

import { agentEvents, agentLog } from './agent-log.ts'
import { inDatabase } from './agent-sign-in-scenarios.ts'
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

type Hook = Trigger & { webhookSecret: string }

async function createWebhook(stack: Stack, sessionId: string, name: string, extra = {}) {
  return client(stack)<Hook>('POST', '/agent/triggers', {
    teamId: stack.teamId,
    targetSessionId: sessionId,
    name,
    triggerType: 'webhook',
    messageTemplate: 'Alert {{payload.state}} {{payload.hold}} E2E_DELIVERY:{{payload.id}}',
    ...extra,
  })
}

/** One delivery as a sender makes it, signed with the Trigger's secret. */
async function deliver(stack: Stack, hook: Hook, payload: Record<string, string>) {
  const response = await fetch(`${stack.apiUrl}/webhooks/${hook.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Webhook-Secret': hook.webhookSecret },
    body: JSON.stringify({ hold: '', ...payload }),
  })

  return {
    status: response.status,
    retryAfter: response.headers.get('Retry-After'),
    body: (await response.json()) as { ok: boolean; reason?: string },
  }
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
      const summary = page.getByLabel('Task summary', { exact: true })

      if (await summary.isVisible()) await toggle.click()
      await toggle.click()
      await summary.getByText(notice).waitFor()
      // The panel slides in; shoot it once it has settled.
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: join(artifacts, 'trigger-paused.png') })
      await toggle.click()

      // #4293: the Trigger's card in the chat says why as well, not only that it is paused.
      await send(page, `Show it E2E_TRIGGER_CARD:${tooLong.id} E2E_DELIVERY:trigger-card`)
      await page.getByText('ACK E2E_DELIVERY:trigger-card').waitFor()
      const card = page.getByRole('region', { name: 'Trigger Hourly report' })

      await card.getByText(notice).waitFor()
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(artifacts, 'trigger-card-paused.png') })
    },
  },
  {
    // #3703: a delivery within a minute of the one before got 200 rate_limited and was dropped.
    name: 'webhook alerts seconds apart all reach the Task, the later ones together after the running turn',
    // The minIntervalSeconds part expects its second delivery to be refused.
    expected: /"path":"\/webhooks\/[^"]+","status":429/u,
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of the webhook E2E_DELIVERY:hook-home')
      await page.getByText('ACK E2E_DELIVERY:hook-home').waitFor()
      const sessionId = await taskWith(stack, 'E2E_DELIVERY:hook-home')
      const hook = await createWebhook(stack, sessionId, 'Grafana alerts')

      // The first alert starts a turn that keeps running.
      const firing = await deliver(stack, hook, {
        state: 'firing',
        hold: 'E2E_HOLD',
        id: 'hook-firing',
      })

      await until('the agent to start the first alert', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:hook-firing'),
      )
      // Seconds later, while it runs: each is accepted, not acknowledged and dropped.
      const resolved = await deliver(stack, hook, { state: 'resolved', id: 'hook-resolved' })
      const again = await deliver(stack, hook, { state: 'firing again', id: 'hook-again' })

      console.log(`Deliveries: ${JSON.stringify([firing, resolved, again])}`)
      for (const answer of [firing, resolved, again])
        if (answer.status !== 200 || !answer.body.ok)
          throw new Error(`A delivery was not accepted: ${JSON.stringify(answer)}`)
      // Stopped without a reply, the first alert stays in the next turn's prompt, and with it
      // E2E_HOLD: that turn keeps running too, so its start is what shows it.
      await page.locator('button[title="Stop"]').click()
      await until('the later alerts to start', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:hook-again'),
      )
      const turns = agentLog(stack)
        .filter((entry) => entry.sessionId && entry.event === 'start')
        .map((entry) => entry.markers ?? [])
        .filter((markers) => markers.some((marker) => marker.startsWith('E2E_DELIVERY:hook-')))
      const after = turns.filter((markers) => markers.includes('E2E_DELIVERY:hook-resolved'))

      console.log(`Turns: ${JSON.stringify(turns)}`)
      // One turn after the running one, carrying both later alerts in the order they came.
      if (
        after.length !== 1 ||
        after[0]!.indexOf('E2E_DELIVERY:hook-resolved') >
          after[0]!.indexOf('E2E_DELIVERY:hook-again')
      )
        throw new Error(`The later alerts did not run together, in order: ${JSON.stringify(turns)}`)
      await page.locator('button[title="Stop"]').click()
      await until('the later alerts to stop', async () =>
        agentEvents(stack).includes('cancelled E2E_DELIVERY:hook-again'),
      )

      // A Trigger set to fire at most every 5 minutes asks the sender to come back, not ok.
      const limited = await createWebhook(stack, sessionId, 'At most every 5 minutes', {
        minIntervalSeconds: 300,
      })
      const first = await deliver(stack, limited, { state: 'firing', id: 'hook-limited' })
      const soon = await deliver(stack, limited, { state: 'resolved', id: 'hook-limited-soon' })

      console.log(`Rate-limited deliveries: ${JSON.stringify([first, soon])}`)
      if (first.status !== 200 || soon.status !== 429 || soon.retryAfter !== '300')
        throw new Error(`A delivery inside the limit was not refused: ${JSON.stringify(soon)}`)
      await until('the accepted one to start', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:hook-limited'),
      )
      await page.locator('button[title="Stop"]').click()
    },
  },
  {
    // #3718: a fire whose agent is gone failed before its turn and was never counted, so it never paused.
    name: 'a Trigger whose agent is gone pauses after three fires and says to move the Task',
    expected: /runtime_not_found|This agent is no longer available to you/,
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Soon without its agent E2E_DELIVERY:trigger-gone')
      await page.getByText('ACK E2E_DELIVERY:trigger-gone').waitFor()
      const sessionId = await taskWith(stack, 'E2E_DELIVERY:trigger-gone')

      // The agent's computer is gone: the Task now names one that is not in the team.
      inDatabase(
        stack.mongoUri,
        `const row = await db.collection('agent_conversations').findOne({ sessionId: process.argv[2] })
        await db.collection('agent_conversations').updateOne({ sessionId: process.argv[2] },
          { $set: { runtimeId: 'local_' + row.userId + '_gone-computer' } })`,
        sessionId,
      )
      const api = client(stack)
      const trigger = await createTrigger(
        stack,
        sessionId,
        'Gone report',
        'Report E2E_DELIVERY:gone',
      )
      const read = () => api<Trigger>('GET', `/agent/triggers/${trigger.id}?teamId=${stack.teamId}`)

      for (let fire = 1; fire <= 3; fire++) {
        await api('POST', `/agent/triggers/${trigger.id}/test-fire?teamId=${stack.teamId}`)
        // Each fails before any turn starts; give it time to be recorded.
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        if (fire < 3 && !(await read()).enabled)
          throw new Error(`${String(fire)} failures paused the Trigger`)
      }
      await until('the Trigger to pause', async () => !(await read()).enabled)
      const paused = await read()

      console.log(`Agent gone 3 times: ${JSON.stringify(paused)}`)
      if (!paused.executionAuthorizationError?.includes('Move this conversation to another agent'))
        throw new Error(`The Trigger was not paused with its reason: ${JSON.stringify(paused)}`)
    },
  },
]
