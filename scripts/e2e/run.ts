// `bun run e2e`: the Desktop app against a real backend, database and OpenAB, with a
// deterministic agent in place of a model. Each scenario is a flow a person takes.
import { rmSync } from 'node:fs'

import { agentEvents, agentLog, delegatedTurn } from './agent-log.ts'
import { backendFailures, backendLines, backendLog } from './backend-log.ts'
import { startDesktop } from './desktop.ts'
import { formScenario } from './form-scenario.ts'
import { artifacts, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'
import { newTask, send } from './ui.ts'

import type { Desktop } from './desktop.ts'
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

type Scenario = {
  name: string
  run: (page: Page, stack: Stack) => Promise<void>
  /** A backend failure this scenario alone is known to cause. */
  expected?: RegExp
}

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
    // The flow #2412 was reported in: a Bot's credential question with choices, answered in its chat.
    name: 'create a Bot, talk to it in its chat, and answer its question there',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'New Bot', exact: true }).click()
      await page.getByRole('textbox', { name: 'Agent name' }).fill('E2E Bot')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await send(page, 'Ask me E2E_ASK_CREDENTIAL E2E_DELIVERY:bot')
      await page.getByText('POSTED E2E_DELIVERY:bot', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await until('the answer in the Bot chat to reach the Bot', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
      )
    },
  },
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
    // A runtime restart between turns, the situation #2612 was reported in. Not checked against its fix.
    name: 'the agent host restarts between two messages and the conversation carries on',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Before the restart E2E_DELIVERY:before')
      await page.getByText('ACK E2E_DELIVERY:before').waitFor()
      await stack.restartAgentHost(async () => {
        // #2901: opened while its agent host is down, the conversation is prewarmed.
        const from = backendLines()

        await page.reload()
        await until('the app to read the conversation’s settings', async () =>
          backendLog(from).some((line) => line.includes('/model-config"')),
        )
      })
      await send(page, 'After the restart E2E_DELIVERY:after')
      await page.getByText('ACK E2E_DELIVERY:after').waitFor()
      if (!agentEvents(stack).includes('loaded')) {
        throw new Error('The agent was not asked to load the earlier session')
      }
    },
  },
  {
    // #2760 and #2761: create_thread names the agent and the fast mode a new Task starts with.
    // #2885: the fast Task comes first, on an agent that has not run a conversation yet.
    name: 'the agent delegates to another agent in fast mode, and the new Task starts there',
    run: async (page, stack) => {
      if (agentLog(stack).some((entry) => entry.agent === 'second' && entry.event === 'start')) {
        throw new Error('The second agent ran a conversation before this scenario')
      }
      await newTask(page)
      await send(page, 'Delegate fast E2E_DELEGATE_FAST E2E_DELIVERY:delegating-fast')
      await until('the fast delegated Task to finish', async () =>
        delegatedTurn(stack, 'E2E_DELIVERY:child-fast'),
      )
      await page.getByText('ACK E2E_DELIVERY:delegating-fast', { exact: true }).waitFor()
      await send(page, 'Delegate E2E_DELEGATE E2E_DELIVERY:delegating')
      await until('the delegated Task to finish', async () =>
        delegatedTurn(stack, 'E2E_DELIVERY:child'),
      )
      const log = agentLog(stack)
      const children = log.filter((entry) => entry.marker?.startsWith('E2E_DELIVERY:child'))
      const strays = children.filter((entry) => entry.agent !== 'second')

      if (strays.length > 0) {
        throw new Error(`A delegated Task ran on its parent's agent: ${JSON.stringify(strays)}`)
      }
      const fast = delegatedTurn(stack, 'E2E_DELIVERY:child-fast')
      const session = log.find(
        (entry) => entry.event === 'session' && entry.sessionId === fast?.sessionId,
      )

      if (session?.defaults?.fast !== 'on') {
        throw new Error(`The fast Task's session was not created fast: ${JSON.stringify(session)}`)
      }
      const refusal = log.find((entry) => entry.event === 'refused')?.detail

      if (!refusal?.includes('Choose one of: off, on')) {
        throw new Error(`A speed not on offer was not refused with the choices: ${refusal ?? ''}`)
      }
    },
  },
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

scenarios.push(formScenario)

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
    const failures = backendFailures(from, scenario.expected)

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
