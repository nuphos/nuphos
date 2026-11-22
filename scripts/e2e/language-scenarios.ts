// #3469: the language Nuphos tells an agent to write in, where no person wrote to it.
import { agentLog } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const languageScenarios: Scenario[] = [
  {
    // A sub-agent hears only its parent agent's English, yet its owner's questions must come
    // in the language the owner writes, on every turn of a session already running: the
    // system prompt reaches a running agent only when its session opens.
    name: 'a running sub-Task that hears only English is told, every turn, to write Traditional Chinese',
    run: async (page, stack) => {
      const before = agentLog(stack).length
      const since = () => agentLog(stack).slice(before)
      const turn = (marker: string) =>
        since().find((entry) => entry.event === 'start' && entry.marker === marker)
      const call = async (words: string, name: string, args: unknown, marker: string) => {
        await send(page, `${words} E2E_CALL ${name} ${JSON.stringify(args)} E2E_DELIVERY:${marker}`)
        await page.getByText(`ACK E2E_DELIVERY:${marker}`, { exact: true }).waitFor()
      }

      await newTask(page)
      // Plain words first: a thread names its parent by this first message.
      await send(page, '請幫我規劃這件事 E2E_DELIVERY:lang-plan')
      await page.getByText('ACK E2E_DELIVERY:lang-plan', { exact: true }).waitFor()
      const start = {
        label: 'Start',
        title: 'E2E language kid',
        prompt: 'Start E2E_DELIVERY:lang-kid-1',
      }

      await call('請開一個子任務', 'create_thread', start, 'lang-start')
      await until('the sub-Task to finish its first turn', async () =>
        since().some(
          (entry) => entry.event === 'finish' && entry.marker === 'E2E_DELIVERY:lang-kid-1',
        ),
      )
      const created = since().find(
        (entry) => entry.event === 'called' && entry.name === 'create_thread',
      )
      const threadId = /threadId[\\": ]*([0-9a-f-]{36})/.exec(JSON.stringify(created?.result))?.[1]

      must(Boolean(threadId), `create_thread to return a threadId, got ${JSON.stringify(created)}`)
      const again = {
        label: 'Again',
        threadId,
        prompt: 'Ask the owner now E2E_DELIVERY:lang-kid-2',
      }

      await call('請再交代一次', 'send_message_to_thread', again, 'lang-again')
      await until('the running sub-Task to start its second turn', async () =>
        Boolean(turn('E2E_DELIVERY:lang-kid-2')),
      )
      const first = turn('E2E_DELIVERY:lang-kid-1')
      const second = turn('E2E_DELIVERY:lang-kid-2')
      const opened = since().filter(
        (entry) => entry.event === 'session' && entry.sessionId === second?.sessionId,
      )

      must(
        second?.sessionId === first?.sessionId && opened.length === 1,
        'both turns to run in one session',
      )
      for (const entry of [first, second]) {
        must(
          Boolean(entry?.language?.startsWith('Traditional Chinese')),
          `every sub-Task turn to name Traditional Chinese, got ${JSON.stringify(entry)}`,
        )
      }
    },
  },
]
