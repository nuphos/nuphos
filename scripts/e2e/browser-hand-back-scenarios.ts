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
    name: 'closing a browser window the agent showed wakes the agent; a page closing itself does not',
    run: async (page, stack) => {
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<title>E2E sign-in</title><h1>Signed in</h1>')
      })
      const api = async (method: string, route: string, body?: unknown) =>
        fetch(`${stack.apiUrl}${route}`, {
          method,
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      const answers: string[] = []
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
        const answer = JSON.stringify(call?.result)

        answers.push(`${JSON.stringify(args)}\n-> ${answer}`)
        writeFileSync(join(artifacts, 'browser-hand-back.txt'), answers.join('\n\n'))

        return { session: call?.sessionId ?? '', answer }
      }
      const tabOf = (answer: string) => {
        const tab = Number(/tab\W+(\d+)/.exec(answer)?.[1])

        if (!tab) throw new Error(`open answered without a tab: ${answer}`)

        return tab
      }
      // A turn the person never sent: no delivery marker in its prompt.
      const woke = (from: number, session: string) =>
        agentLog(stack)
          .slice(from)
          .some(
            (entry) =>
              entry.event === 'start' && entry.sessionId === session && !entry.markers?.length,
          )

      await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
      try {
        const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`

        await newTask(page)
        // A page closing its own window ends its tab without the window's close event, so it
        // never hands the browser back.
        const own = await browse({ action: 'open', url })
        const quiet = agentLog(stack).length

        await browse({
          action: 'eval',
          tab: tabOf(own.answer),
          script: 'setTimeout(() => window.close(), 0); 1',
        })
        await new Promise((resolve) => setTimeout(resolve, 3000))
        if (woke(quiet, own.session)) throw new Error('a page closing itself woke the agent')

        const tab = tabOf((await browse({ action: 'open', url })).answer)
        const shown = await browse({ action: 'show', tab })

        if (shown.answer.includes('isError')) throw new Error(`show failed: ${shown.answer}`)
        await page.screenshot({ path: join(artifacts, 'browser-hand-back-shown.png') })
        const { conversations } = (await (
          await api('GET', `/agent/conversations?teamId=${stack.teamId}&limit=1`)
        ).json()) as { conversations: { sessionId: string }[] }
        const before = agentLog(stack).length
        // What the app sends when the person closes the shown window (browser-hand-back.ts).
        // The close itself is a native window event a page cannot raise; browser-tabs.test.ts
        // covers it.
        const response = await api(
          'POST',
          `/agent/conversations/${conversations[0]?.sessionId ?? ''}/browser/hand-back?teamId=${stack.teamId}`,
          { tab },
        )

        if (!response.ok) throw new Error(`hand-back answered ${String(response.status)}`)
        await until('the agent to wake after the hand-back', async () =>
          woke(before, shown.session),
        )
        await page.screenshot({ path: join(artifacts, 'browser-hand-back-woken.png') })
      } finally {
        server.close()
      }
    },
  },
]
