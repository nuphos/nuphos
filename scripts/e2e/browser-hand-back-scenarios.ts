// #4230: closing a browser window the agent showed the person hands the browser back,
// and the conversation wakes on its own to carry on.
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { AddressInfo } from 'node:net'
import type { Scenario } from './ui.ts'

export const browserHandBackScenarios: Scenario[] = [
  {
    name: 'closing a browser window the agent showed wakes the agent',
    run: async (page, stack) => {
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<title>E2E sign-in</title><h1>Signed in</h1>')
      })
      let step = 0
      const browse = async (args: Record<string, unknown>) => {
        const marker = `hand-back-${String(++step)}`
        const before = agentLog(stack).length

        await send(
          page,
          `Browse E2E_CALL local_browser ${JSON.stringify({ label: 'Sign in', ...args })} E2E_DELIVERY:${marker}`,
        )
        await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
        const call = agentLog(stack)
          .slice(before)
          .find((entry) => entry.event === 'called')

        return { session: call?.sessionId ?? '', answer: JSON.stringify(call?.result) }
      }

      await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
      try {
        const { port } = server.address() as AddressInfo

        await newTask(page)
        const opened = await browse({ action: 'open', url: `http://127.0.0.1:${String(port)}/` })
        const tab = Number(/tab\W+(\d+)/.exec(opened.answer)?.[1])

        if (!tab) throw new Error(`open answered without a tab: ${opened.answer}`)
        const close = { action: 'eval', tab, script: 'setTimeout(() => window.close(), 0); 1' }
        const woke = (from: number, session: string) =>
          agentLog(stack)
            .slice(from)
            .some(
              (entry) =>
                entry.event === 'start' && entry.sessionId === session && !entry.markers?.length,
            )
        const hidden = agentLog(stack).length

        // A hidden tab's page closing its own window is not the person handing it back.
        await browse(close)
        const shown = await browse({ action: 'show', tab })

        await new Promise((resolve) => setTimeout(resolve, 3000))
        if (woke(hidden, shown.session)) throw new Error('closing a hidden window woke the agent')

        writeFileSync(join(artifacts, 'browser-hand-back.txt'), shown.answer)
        if (shown.answer.includes('isError')) throw new Error(`show failed: ${shown.answer}`)
        const before = agentLog(stack).length

        // The page closes its own shown window: the same close event as the person clicking
        // its close button, which an agent's `close` action never sends.
        await browse(close)
        await until('the agent to wake after the shown window closed', async () =>
          woke(before, shown.session),
        )
        await page.screenshot({ path: join(artifacts, 'browser-hand-back.png') })
      } finally {
        server.close()
      }
    },
  },
]
