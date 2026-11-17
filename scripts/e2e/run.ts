// `bun run e2e`: the Desktop app against a real backend, database and OpenAB, with a
// deterministic agent in place of a model. Each scenario is a flow a person takes.
import { rmSync } from 'node:fs'

import { accessScenarios } from './access-scenarios.ts'
import { agentEvents } from './agent-log.ts'
import { backendFailures, backendLines } from './backend-log.ts'
import { checkDecisionOutline, checkOutgoingChip } from './chat-presentation.ts'
import { channelScenarios } from './channel-scenarios.ts'
import { commandScenarios } from './command-scenarios.ts'
import { computerScenarios } from './computer-scenarios.ts'
import { connectorScenarios } from './connector-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { offlineScenarios } from './offline-scenarios.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { runtimeScenarios } from './runtime-scenarios.ts'
import { startStack } from './stack.ts'
import { threadScenarios } from './thread-scenarios.ts'
import { triggerScenarios } from './trigger-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Desktop } from './desktop.ts'
import type { Scenario } from './ui.ts'

const scenarios: Scenario[] = [
  {
    name: 'sign in with an email code and land in the team',
    run: async (page, stack) => {
      await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
      await page.reload()
      await page.locator('input[type=email]').fill(stack.email)
      await page.getByRole('button', { name: 'Continue with email' }).click()
      await page.getByText('Enter the 6-digit code').waitFor()
      // Entering the sixth digit submits the form.
      await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
      await page.getByText('Start with your first Bot').waitFor()
    },
  },
  {
    // The flow #3012 was reported in: the sidebar is on Bots, the page a new team opens on.
    // The connector's CLI (`aws`) has to be on the PATH for the dialog to offer the agent.
    name: 'set up a cloud connector with the agent from the Bots page, and the setup turn runs',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'Connectors', exact: true }).click()
      await page.getByRole('button', { name: 'Add AWS' }).click()
      await page.getByRole('button', { name: /Set up with agent/ }).click()
      await page.getByText('ACK E2E_DELIVERY:missing').waitFor()
      await until('the setup prompt to reach the agent', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:missing'),
      )
      // Back where a new team starts, for the scenarios that follow.
      await page.getByRole('tab', { name: 'Bots' }).click()
    },
  },
  {
    // The flow #2412 was reported in: a Bot's credential question with choices, answered in its chat.
    name: 'create a Bot, talk to it in its chat, and answer its question there',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'New Bot', exact: true }).click()
      await page.getByRole('textbox', { name: 'Agent name' }).fill('E2E Bot')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      // No user prompt precedes this reply: creating/opening the Bot starts its introduction.
      // The fixture's missing marker proves the turn did not originate from a delivery prompt.
      await page.getByText('POSTED E2E_DELIVERY:missing', { exact: true }).waitFor()
      await until('the unprompted Bot introduction to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:missing'),
      )
      await page.screenshot({ path: `${artifacts}/bot-first-reply.png` })
      await send(
        page,
        'Review https://github.com/nuphos/nuphos/issues/1 E2E_ASK_CREDENTIAL E2E_DELIVERY:bot',
      )
      await page.getByText('POSTED E2E_DELIVERY:bot', { exact: true }).waitFor()
      await checkDecisionOutline(page)
      await checkOutgoingChip(page)
      await page.screenshot({ path: `${artifacts}/bot-question-outline.png` })
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await until('the answer in the Bot chat to reach the Bot', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
      )
    },
  },
  ...channelScenarios,
  {
    name: 'start a Task, send a message and read the reply',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Say hello E2E_DELIVERY:first')
      await page.getByText('ACK E2E_DELIVERY:first').waitFor()
    },
  },
  {
    // The flow #2812 was reported in. Its race (a Stop during the queued turn's startup) is not reproduced.
    name: 'queue a message during a turn, press Stop, and the queued message still runs',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Work until stopped E2E_HOLD E2E_DELIVERY:held')
      await until('the agent to start the held turn', async () =>
        agentEvents(stack).includes('start E2E_DELIVERY:held'),
      )
      await send(page, 'Then this E2E_DELIVERY:queued')
      await page.getByText('Queued messages').waitFor()
      await page.locator('button[title="Stop"]').click()
      await page.getByText('Turn stopped').waitFor()
      await page.getByText('ACK E2E_DELIVERY:queued').waitFor()
      const events = agentEvents(stack)

      if (
        events.indexOf('cancelled E2E_DELIVERY:held') > events.indexOf('start E2E_DELIVERY:queued')
      ) {
        throw new Error(`The queued message ran before the turn was stopped: ${events.join(', ')}`)
      }
    },
  },
  {
    // #2872: the agent read the message once its session opened, seconds after the Stop.
    name: 'Stop while the agent is still starting, and the agent never reads the message',
    run: async (page, stack) => {
      const openings = () => agentEvents(stack).filter((event) => event === 'opening').length
      const before = openings()
      const open = stack.holdSessionOpening()

      try {
        await newTask(page)
        await send(page, 'Stopped before it starts E2E_DELIVERY:stopped')
        await until('the agent to be asked for a session', async () => openings() > before)
        await page.locator('button[title="Stop"]').click()
        // The Stop has to reach the agent host while the session is still opening.
        await page.waitForTimeout(2_000)
      } finally {
        open()
      }
      await page.getByText('Turn stopped').waitFor()
      await send(page, 'Sent after the stop E2E_DELIVERY:after-stop')
      await page.getByText('ACK E2E_DELIVERY:after-stop').waitFor()
      const events = agentEvents(stack)

      if (events.includes('start E2E_DELIVERY:stopped')) {
        throw new Error(`The agent read a message stopped before it started: ${events.join(', ')}`)
      }
    },
  },
  {
    // An ordinary question. #2412 was a credential-category card in a Bot chat, which this does not cover.
    name: 'the agent asks a question and the answer on its card reaches the agent',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:asking')
      await page
        .getByRole('heading', { name: 'Which marker should the fixture use?' })
        .last()
        .waitFor()
      await checkDecisionOutline(page)
      await page.screenshot({ path: `${artifacts}/question-pending.png` })
      // #2972: a question is answered on its card; nothing above the composer answers it.
      if (await page.getByRole('group', { name: 'Reply target' }).count()) {
        throw new Error('A "Replying to" chip is above the composer')
      }
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await page.getByText('ACK E2E_DELIVERY:answered').waitFor()
    },
  },
  {
    // The flow #2844 was reported in. Reverting its fix does not fail this, so its trigger is not covered.
    name: 'a link in an Inbox question keeps the question, which is then answered from the Inbox',
    run: async (page, stack) => {
      await send(page, 'Ask again E2E_ASK E2E_DELIVERY:again')
      await page.getByText('ACK E2E_DELIVERY:again').waitFor()
      // #2972: what the composer sends meanwhile is an ordinary message; the question stays open.
      await send(page, 'A note while it waits E2E_DELIVERY:note')
      await page.getByText('ACK E2E_DELIVERY:note').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('link', { name: /\/health\/ready$/ }).click()
      // The link opens in the dock; give a wrong navigation the time to happen.
      await page.waitForTimeout(2_000)
      await page.getByRole('button', { name: 'E2E_DELIVERY:other' }).click()
      await page.getByRole('heading', { name: /^Answered/ }).waitFor()
      // The answer is sent once its Undo has expired.
      await until('the Inbox answer to reach the agent', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:other'),
      )
    },
  },
  {
    // #2870: a credential question with choices and no secret to save is an ordinary choice card.
    name: 'the agent asks a credential question with choices and its card and the Inbox answer it',
    run: async (page, stack) => {
      const finished = () =>
        agentEvents(stack).filter((event) => event === 'finish E2E_DELIVERY:other').length
      const before = finished()

      await newTask(page)
      await send(page, 'Ask me E2E_ASK_CREDENTIAL E2E_DELIVERY:credential')
      // A credential question with choices is an ordinary question card, with no category label.
      await page
        .getByRole('heading', { name: 'Which marker should the fixture use?' })
        .last()
        .waitFor()
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await page.getByText('ACK E2E_DELIVERY:answered').waitFor()
      await send(page, 'Ask again E2E_ASK_CREDENTIAL E2E_DELIVERY:credential-again')
      await page.getByText('ACK E2E_DELIVERY:credential-again').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('button', { name: 'E2E_DELIVERY:other' }).click()
      await page.getByRole('heading', { name: /^Answered/ }).waitFor()
      await until('the Inbox answer to reach the agent', async () => finished() === before + 1)
    },
  },
  {
    // #2998: Skip withdrew the question silently; the agent that asked was never told.
    name: 'skipping a question on its card tells the agent that asked',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:skip')
      await page.getByText('ACK E2E_DELIVERY:skip').waitFor()
      await page.getByRole('button', { name: 'Skip', exact: true }).last().click()
      // The card leaves with its question; the agent's wake notice stays in the chat.
      await page.getByText(/was skipped: no answer is coming/).waitFor()
      await until('the agent to be told its question was skipped', async () =>
        agentEvents(stack).includes('skipped E2E_DELIVERY:missing'),
      )
      await page.getByText('ACK E2E_DELIVERY:missing').waitFor()
      await page.screenshot({ path: `${artifacts}/question-skipped.png` })
    },
  },
  ...triggerScenarios,
  ...connectorScenarios,
  ...accessScenarios,
  ...runtimeScenarios,
  ...computerScenarios,
  ...commandScenarios,
  ...threadScenarios,
  ...offlineScenarios,
  {
    // #2577: a Task under another has no permission mode of its own. The parent here is a
    // plain Task in Full Access, not a Bot. Last, because its thread is left waiting for a person.
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
      await page.getByText('Auto Mode', { exact: true }).click()
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
    },
  },
]

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()

  desktop = await startDesktop(stack.apiUrl)
  desktop.page.setDefaultTimeout(30_000)
  for (const [index, scenario] of scenarios.entries()) {
    const from = backendLines()

    await scenario.run(desktop.page, stack)
    const failures = backendFailures(from)

    await desktop.page.screenshot({ path: `${artifacts}/${String(index + 1)}.png` })
    if (failures.length > 0)
      throw new Error(`"${scenario.name}" made the backend fail:\n${failures.join('\n')}`)
    console.log(`PASS ${scenario.name}`)
  }
  console.log('PASS Desktop end-to-end (real backend, MongoDB and OpenAB; fixture agent)')
} catch (error) {
  failed = true
  console.error(error)
  console.error(`FAIL: logs and the last screenshot are in ${artifacts}`)
} finally {
  await desktop?.close()
  await stopAll()
  if (desktop) rmSync(desktop.profile, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
