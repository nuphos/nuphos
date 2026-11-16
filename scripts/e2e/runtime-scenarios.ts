// Scenarios about the agent hosts a Task runs on: a restart, delegation, a move.
import { agentEvents, agentLog, delegatedTurn } from './agent-log.ts'
import { backendLines, backendLog } from './backend-log.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

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
      await page.getByRole('button', { name: /^Agent runtime/ }).click()
      // The computer's row opens a submenu of its runtimes.
      await page.getByRole('menu').getByText('E2E second agent').click()
      await page.getByRole('menuitem', { name: /^E2E second agent.*Claude Code/ }).click()
      await page.getByRole('button', { name: 'Move', exact: true }).click()
      await send(page, 'After the move E2E_DELIVERY:after-move')
      await until('the moved Task to finish on the second agent', async () =>
        agentLog(stack).some(
          (entry) => entry.agent === 'second' && entry.marker === 'E2E_DELIVERY:after-move',
        ),
      )
      await page.getByText('ACK E2E_DELIVERY:after-move').waitFor()
    },
  },
]
