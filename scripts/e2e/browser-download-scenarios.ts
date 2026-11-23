// #3299: a download in an agent's browser tab is saved with no save dialog, and the agent hears where.
// The person sees it too: a notice in the tab's window says it started and where it went.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'
import type { Scenario } from './ui.ts'

/** The window's notice saying `title`, a page of its own in the app: each notice is a new one. */
async function noticeOf(page: Page, title: string): Promise<Page> {
  let notice: Page | undefined

  await until(`the notice "${title}"`, async () => {
    notice = page
      .context()
      .browser()
      ?.contexts()
      .flatMap((context) => context.pages())
      .find(
        (p) =>
          p.url().startsWith('data:text/html') &&
          decodeURIComponent(p.url()).includes(`<b>${title}</b>`),
      )

    return notice
  })

  return notice!
}

/** The screen as the person sees it, notice over the shown tab, when the runner can grab it. */
function screen(file: string): void {
  const out = join(artifacts, file)
  const grabs: [string, string[]][] = [
    ['import', ['-window', 'root', out]],
    ['ffmpeg', ['-y', '-f', 'x11grab', '-i', process.env.DISPLAY ?? ':99', '-frames:v', '1', out]],
  ]

  for (const [command, args] of grabs) {
    try {
      execFileSync(command, args, { stdio: 'ignore', timeout: 10_000 })

      return
    } catch {
      // Not every runner has it; the notice's own capture still shows it.
    }
  }
}

export const browserDownloadScenarios: Scenario[] = [
  {
    name: "an agent's browser tab downloads a file into Downloads without a dialog, with a notice",
    run: async (page, stack) => {
      const content = `downloaded by the agent ${randomUUID()}`
      const name = `e2e-${randomUUID().slice(0, 8)}.txt`
      const server = createServer((request, response) => {
        if (request.url === '/file') {
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${name}"`,
          })
          // Slow enough that the notice is seen while the file is still coming.
          response.write(content.slice(0, 10))
          setTimeout(() => response.end(content.slice(10)), 5000)
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
        // On screen, as when the person clicks the link themselves.
        await browse({ action: 'show', tab })
        const clicked = await browse({
          action: 'eval',
          tab,
          script: "document.getElementById('file').click(); 'clicked'",
        })

        if (clicked.includes('isError')) throw new Error(`The click failed: ${clicked}`)
        const started = await noticeOf(page, `Downloading ${name}…`)

        await started.getByText('Saving to').waitFor()
        await started.screenshot({ path: join(artifacts, 'download-notice-started.png') })
        screen('download-screen-started.png')
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

        // The Downloads folder itself, which on a Linux runner with none set up is the home folder.
        const folder = dirname(path)
        const home = homedir()
        const shown = folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder

        const notice = await noticeOf(page, `Downloaded ${name}`)

        await notice.getByText(`Saved to ${shown}`, { exact: true }).waitFor()
        await notice.getByText(/Show in (Finder|folder)/).waitFor()
        await notice.screenshot({ path: join(artifacts, 'download-notice-completed.png') })
        screen('download-screen-completed.png')
        await page.screenshot({ path: join(artifacts, 'agent-download.png') })
        if (basename(path) !== name || basename(folder) === 'Nuphos')
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
