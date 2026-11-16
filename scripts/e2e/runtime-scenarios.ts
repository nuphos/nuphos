// Scenarios about the agent hosts a Task runs on: a restart, delegation, a move.
import { agentEvents, agentLog, delegatedTurn } from './agent-log.ts'
import { backendLines, backendLog } from './backend-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

async function pickAgent(page: Page, label: string) {
  await page.getByRole('button', { name: /^Agent runtime/ }).click()
  // The computer's row opens a submenu of its runtimes.
  await page.getByRole('menu').getByText(label).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${label}.*Claude Code`) }).click()
}

/** Sends while the agent host is `away`, expects the backend to queue the message, then its reply. */
async function sendWhileAway(
  page: Page,
  marker: string,
  away: (during: () => Promise<void>) => Promise<void>,
) {
  await newTask(page)
  await send(page, `Before it is away E2E_DELIVERY:${marker}-before`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}-before`).waitFor()
  await away(async () => {
    const from = backendLines()

    await send(page, `While it is away E2E_DELIVERY:${marker}-during`)
    await until('the backend to queue the message', async () =>
      backendLog(from).some((line) => line.includes('"agent.chat.queued"')),
    )
  })
  await page.getByText(`ACK E2E_DELIVERY:${marker}-during`).waitFor({ timeout: 60_000 })
}

// The delegation scenario needs the second agent unused, so the move comes after it.
export const runtimeScenarios: Scenario[] = [
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
        // #2922: asked once its last reading has expired, the agent's usage reads as offline.
        await until('the agent’s usage to read as offline', async () => {
          const response = await fetch(
            `${stack.apiUrl}/teams/${stack.teamId}/agent-runtimes/quota`,
            {
              headers: { authorization: `Bearer ${stack.token}` },
            },
          )
          const { quotas } = (await response.json()) as { quotas: { offline?: true }[] }

          return quotas.some((quota) => quota.offline)
        })
      })
      await send(page, 'After the restart E2E_DELIVERY:after')
      await page.getByText('ACK E2E_DELIVERY:after').waitFor()
      if (!agentEvents(stack).includes('loaded')) {
        throw new Error('The agent was not asked to load the earlier session')
      }
    },
  },
  {
    // #3082: a send while the agent host does not answer waits for it, never refused.
    name: 'a message sent while the agent host is down runs once it is back',
    run: (page, stack) => sendWhileAway(page, 'down', stack.restartAgentHost),
  },
  {
    // The same with its sockets open and nothing answering, as a computer mid-reconnect is.
    name: 'a message sent while the agent host hangs runs once it answers again',
    run: (page, stack) => sendWhileAway(page, 'frozen', stack.freezeAgentHost),
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
    // #2331: the Task keeps the model it picked, which the second agent does not offer.
    name: 'pick a model only this agent offers, move the Task to another agent, and it carries on',
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Before the move E2E_DELIVERY:before-move')
      await page.getByText('ACK E2E_DELIVERY:before-move').waitFor()
      await page.getByRole('button', { name: /^Model settings/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /fixture-large/ }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Model settings: fixture-large/ }).waitFor()
      await pickAgent(page, 'E2E second agent')
      await page.getByText('moved this task from E2E fixture agent to E2E second agent').waitFor()
      // #2123: the second agent's default model was never applied to this Task, so its
      // list, once read from that agent, shows no model as the current one.
      await page.getByRole('button', { name: /^Model settings/ }).click()
      await until('the second agent’s models, none of them current', async () => {
        const models = page.getByRole('menuitemcheckbox')
        const names = await models.allTextContents()

        return (
          names.some((name) => name.includes('fixture-small')) &&
          !names.some((name) => name.includes('fixture-large')) &&
          (await page.getByRole('menuitemcheckbox', { checked: true }).count()) === 0
        )
      })
      await page.keyboard.press('Escape')
      await send(page, 'After the move E2E_DELIVERY:after-move')
      await until('the moved Task to finish on the second agent', async () =>
        agentLog(stack).some(
          (entry) => entry.agent === 'second' && entry.marker === 'E2E_DELIVERY:after-move',
        ),
      )
      await page.getByText('ACK E2E_DELIVERY:after-move').waitFor()
    },
  },
  {
    // #2122: a model both agents offer stays the Task's own when it moves between them.
    name: 'pick a model both agents offer, move the Task, and its new session starts on that model',
    run: async (page, stack) => {
      await newTask(page)
      // A new Task starts on the agent last used, the second one since the move above.
      await pickAgent(page, 'E2E fixture agent')
      await send(page, 'Before the move E2E_DELIVERY:before-kept')
      await page.getByText('ACK E2E_DELIVERY:before-kept').waitFor()
      await page.getByRole('button', { name: /^Model settings/ }).click()
      await page.getByRole('menuitemcheckbox', { name: /fixture-small/ }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Model settings: fixture-small/ }).waitFor()
      await pickAgent(page, 'E2E second agent')
      await page.getByText('moved this task from E2E fixture agent to E2E second agent').waitFor()
      await send(page, 'After the move E2E_DELIVERY:after-kept')
      await page.getByText('ACK E2E_DELIVERY:after-kept').waitFor()
      const log = agentLog(stack)
      const turn = log.find(
        (entry) => entry.agent === 'second' && entry.marker === 'E2E_DELIVERY:after-kept',
      )
      const session = log.find(
        (entry) => entry.event === 'session' && entry.sessionId === turn?.sessionId,
      )

      if (session?.defaults?.model !== 'fixture-small') {
        throw new Error(
          `The moved Task's session was not created on its model: ${JSON.stringify(session)}`,
        )
      }
    },
  },
  {
    // A team's proxy serves only the models it names: a Task nobody picked a model for must
    // never send the one Claude Code's "Default" stands for, here or after a move.
    name: 'a Task whose model was never picked keeps the agent default, also after a move',
    run: async (page, stack) => {
      const stopOffering = stack.offerDefaultStandIn()

      await newTask(page)
      await pickAgent(page, 'E2E fixture agent')
      await send(page, 'Never picked E2E_DELIVERY:unpicked')
      await page.getByText('ACK E2E_DELIVERY:unpicked').waitFor()
      await send(page, 'Still not picked E2E_DELIVERY:unpicked-again')
      await page.getByText('ACK E2E_DELIVERY:unpicked-again').waitFor()
      await pickAgent(page, 'E2E second agent')
      await page.getByText('moved this task from E2E fixture agent to E2E second agent').waitFor()
      await send(page, 'After the move E2E_DELIVERY:unpicked-moved')
      await page.getByText('ACK E2E_DELIVERY:unpicked-moved').waitFor()
      stopOffering()
      const log = agentLog(stack)
      const sessions = ['E2E_DELIVERY:unpicked', 'E2E_DELIVERY:unpicked-moved'].map((marker) => {
        const turn = log.find((entry) => entry.event === 'finish' && entry.marker === marker)

        return log.find((entry) => entry.event === 'session' && entry.sessionId === turn?.sessionId)
      })
      const explicit = sessions.filter(
        (session) => !session || (session.defaults?.model ?? 'default') !== 'default',
      )

      if (explicit.length > 0) {
        throw new Error(
          `A Task nobody picked a model for opened a session on a named model: ${JSON.stringify(sessions)}`,
        )
      }
    },
  },
  {
    // #3051: the person moves it off an agent out of usage, and the refused turn runs there once.
    name: 'a turn refused for usage runs again, once, after the Task moves to another agent',
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:usage-limit'
      const ran = () =>
        agentLog(stack).filter(
          (entry) =>
            entry.agent === 'second' && entry.marker === marker && entry.event === 'finish',
        )

      await newTask(page)
      // A new Task starts on the agent last used, the second one since the move above.
      await pickAgent(page, 'E2E fixture agent')
      await send(page, `Out of usage E2E_USAGE_LIMIT ${marker}`)
      await page.getByText('You’ve hit your usage limit').first().waitFor()
      await pickAgent(page, 'E2E second agent')
      await page.getByText('Retrying on E2E second agent').waitFor()
      await until('the refused turn to finish on the second agent', async () => ran().length > 0)
      await page.getByText(`ACK ${marker}`).waitFor()
      // Long enough for a second resend to have started, had there been one.
      await new Promise((resolve) => setTimeout(resolve, 3000))
      if (ran().length !== 1) throw new Error(`The turn ran ${ran().length} times on the new agent`)
    },
  },
  {
    // #3055: an answer its agent cannot run waits, says so, and reaches the agent the Task moves to.
    name: 'an answer its agent is out of usage for waits, then reaches the agent the Task moves to, once',
    run: async (page, stack) => {
      const answered = () =>
        agentLog(stack).filter(
          (entry) =>
            entry.agent === 'second' &&
            entry.marker === 'E2E_DELIVERY:answered' &&
            entry.event === 'finish',
        ).length
      const before = answered()

      await newTask(page)
      await pickAgent(page, 'E2E fixture agent')
      await send(page, 'Ask me late E2E_ASK E2E_ASK_LATE E2E_DELIVERY:asking-late')
      await page
        .getByRole('heading', { name: 'Which marker should the fixture use?' })
        .last()
        .waitFor()
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
      await page.getByText('You’ve hit your usage limit').first().waitFor()
      await page.reload()
      await page.getByText(/^Answered · waiting for E2E fixture agent \(out of usage/).waitFor()
      await page.screenshot({ path: `${artifacts}/answer-waiting.png` })
      await pickAgent(page, 'E2E second agent')
      await until('the answer to reach the second agent', async () => answered() > before)
      // Long enough for a second delivery to have started, had there been one.
      await new Promise((resolve) => setTimeout(resolve, 3000))
      if (answered() !== before + 1)
        throw new Error(`The answer reached the second agent ${answered() - before} times`)
    },
  },
]
