// Scenarios about the threads a Task starts: the cards it shows for them and the model they start on.
import { agentEvents, agentLog, delegatedTurn } from './agent-log.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** A thread card's line under its title (verb, agent, status), empty while the card is missing. */
async function cardLine(page: Page, verb: 'Started' | 'Messaged') {
  return await page
    .locator('span.flex', { has: page.getByText(verb, { exact: true }) })
    .last()
    .innerText({ timeout: 2_000 })
    .catch(() => '')
}

export const threadScenarios: Scenario[] = [
  {
    // #2950: a message to a moved thread showed the agent the thread had started on.
    name: 'a thread moved to another agent shows each message on the agent it ran on',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Start and move a thread E2E_HOP E2E_DELIVERY:hop')
      await until('the moved thread to answer on its new agent', async () =>
        delegatedTurn(stack, 'E2E_DELIVERY:hop-again'),
      )
      await page.getByText('ACK E2E_DELIVERY:hop', { exact: true }).waitFor()
      // Each card names the agent its own message ran on, whichever the Task started on.
      const ran = (marker: string) =>
        delegatedTurn(stack, marker)?.agent === 'second' ? 'E2E second agent' : 'E2E fixture agent'
      const before = ran('E2E_DELIVERY:hop-child')
      const after = ran('E2E_DELIVERY:hop-again')
      const hopped = agentLog(stack).find((entry) => entry.event === 'hopped')?.detail

      if (before === after)
        throw new Error(`The thread did not move off ${before} (${hopped ?? ''})`)
      await until(
        'both thread cards to name an agent',
        async () =>
          (await cardLine(page, 'Started')).includes('E2E') &&
          (await cardLine(page, 'Messaged')).includes('E2E'),
      )
      const started = await cardLine(page, 'Started')
      const messaged = await cardLine(page, 'Messaged')

      if (!started.includes(before) || !messaged.includes(after)) {
        throw new Error(
          `Expected ${before}, then ${after}: "${started}", "${messaged}" (${hopped ?? ''})`,
        )
      }
    },
  },
  {
    // #2577: a thread started with no model picked begins on its parent's. The parent here
    // is a top-level Task; a Bot takes the same create_thread path.
    name: "a thread started with no model picked starts on its parent's model",
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Before the pick E2E_DELIVERY:inherit-parent')
      await page.getByText('ACK E2E_DELIVERY:inherit-parent').waitFor()
      await page.getByRole('button', { name: /^Model settings/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /fixture-small/ }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Model settings: fixture-small/ }).waitFor()
      await send(page, 'Start a thread E2E_INHERIT E2E_DELIVERY:inherit')
      await until('the thread with no pick to finish', async () =>
        delegatedTurn(stack, 'E2E_DELIVERY:inherit-child'),
      )
      const turn = delegatedTurn(stack, 'E2E_DELIVERY:inherit-child')
      const session = agentLog(stack).find(
        (entry) => entry.event === 'session' && entry.sessionId === turn?.sessionId,
      )

      if (session?.defaults?.model !== 'fixture-small') {
        throw new Error(
          `The thread's session was not created on its parent's model: ${JSON.stringify(session)}`,
        )
      }
    },
  },
]

export const threadModeScenario: Scenario = {
  // #2577: a Task under another has no permission mode of its own. The parent here is a
  // plain Task in Full Access, not a Bot.
  name: "a Task's thread runs in the Task's permission mode, follows a change and cannot set its own",
  run: async (page, stack) => {
    const has = (event: string) => agentEvents(stack).includes(event)

    await newTask(page)
    await send(page, 'Start a thread E2E_THREAD E2E_DELIVERY:parent')
    await page.getByText('ACK E2E_DELIVERY:parent').waitFor()
    if (!has('thread-mode-refused E2E_DELIVERY:parent')) {
      throw new Error(`The thread was given a mode of its own: ${agentEvents(stack).join(', ')}`)
    }
    // Full Access above it: the thread's command is allowed without asking anyone.
    await until('the thread to run its command', async () =>
      has('permission-allow E2E_DELIVERY:thread'),
    )
    await page.getByRole('button', { name: 'Authorization mode' }).click()
    await page.getByRole('menuitem', { name: /^Auto Mode/ }).click()
    await send(page, 'Message the thread E2E_POKE E2E_DELIVERY:poke')
    await page.getByText('ACK E2E_DELIVERY:poke').waitFor()
    await until('the thread to ask for its command', async () =>
      has('permission-asked E2E_DELIVERY:thread-again'),
    )
    // Auto Mode above it now: the same command waits for a person instead.
    await page.waitForTimeout(5_000)
    if (has('permission-allow E2E_DELIVERY:thread-again')) {
      throw new Error('The thread kept Full Access after its parent moved to Auto Mode')
    }
    // A later agent host restart would fail a turn still waiting for a person.
    await page.getByText('E2E thread', { exact: true }).click()
    await page.getByRole('button', { name: /^Deny/ }).click()
    await until('the thread to finish', async () => has('finish E2E_DELIVERY:thread-again'))
  },
}
