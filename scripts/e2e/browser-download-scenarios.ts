// #3299: a download in an agent's browser tab is saved with no save dialog, and the agent hears where.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { AddressInfo } from 'node:net'
import type { Scenario } from './ui.ts'

export const browserDownloadScenarios: Scenario[] = [
  {
    name: "an agent's browser tab downloads a file into Downloads/Nuphos without a dialog",
    run: async (page, stack) => {
      const content = `downloaded by the agent ${randomUUID()}`
      const name = `e2e-${randomUUID().slice(0, 8)}.txt`
      const server = createServer((request, response) => {
        if (request.url === '/file') {
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${name}"`,
          })
          response.end(content)
        } else {
          response.writeHead(200, { 'Content-Type': 'text/html' })
          response.end('<a id="file" href="/file">Download</a>')
        }
      })
      let step = 0
      const answers: string[] = []
      const browse = async (args: Record<string, unknown>) => {
        const marker = `browsed-${String(++step)}`
        const before = agentLog(stack).length

        await send(
          page,
          `Browse E2E_CALL local_browser ${JSON.stringify({ label: 'Download the file', ...args })} E2E_DELIVERY:${marker}`,
        )
        await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
        const answer = JSON.stringify(
          agentLog(stack)
            .slice(before)
            .find((entry) => entry.event === 'called')?.result,
        )

        answers.push(`${JSON.stringify(args)}\n-> ${answer}`)
        writeFileSync(join(artifacts, 'agent-download.txt'), answers.join('\n\n'))

        return answer
      }

      await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
      try {
        const { port } = server.address() as AddressInfo

        await newTask(page)
        const opened = await browse({ action: 'open', url: `http://127.0.0.1:${String(port)}/` })
        const tab = Number(/tab\W+(\d+)/.exec(opened)?.[1])

        if (!tab) throw new Error(`open answered without a tab: ${opened}`)
        const clicked = await browse({
          action: 'eval',
          tab,
          script: "document.getElementById('file').click(); 'clicked'",
        })

        if (clicked.includes('isError')) throw new Error(`The click failed: ${clicked}`)
        // A save dialog would hold the download, so it never completes and this times out.
        let saved: RegExpExecArray | null = /Downloaded: (.+?) \(completed, (\d+) bytes\)/.exec(
          clicked,
        )

        await until('the download to be reported', async () => {
          saved ??= /Downloaded: (.+?) \(completed, (\d+) bytes\)/.exec(
            await browse({ action: 'tabs' }),
          )

          return saved
        })
        const [, path = '', bytes] = saved!

        await page.screenshot({ path: join(artifacts, 'agent-download.png') })
        if (basename(path) !== name || basename(dirname(path)) !== 'Nuphos')
          throw new Error(`The file was saved to ${path}`)
        if (!existsSync(path) || readFileSync(path, 'utf8') !== content)
          throw new Error(`${path} does not hold the served file`)
        if (Number(bytes) !== Buffer.byteLength(content)) throw new Error(`Reported ${bytes} bytes`)
        rmSync(path)
      } finally {
        server.close()
      }
    },
  },
]
