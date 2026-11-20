// #3887: a computer running only `nuphos agent` has a headless local_browser. The real host
// opens a page on this machine's Chromium, screenshots it, and records its traffic as a HAR that
// comes back through the tunnel.
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { AddressInfo } from 'node:net'

type Call = [name: string, args: object]
type Content = { type: string; text?: string; data?: string }

/** One turn whose agent makes `calls` in order on a conversation that selected `deviceId`. */
async function callAllOn(stack: Stack, deviceId: string, calls: Call[]) {
  const lines = calls.map(
    ([name, args]) => `E2E_CALL ${name} ${JSON.stringify({ label: 'Call it', ...args })}`,
  )
  const text = `Call them\n${lines.join('\n')}\nE2E_DELIVERY:${randomUUID()}`
  const from = agentLog(stack).length
  let answers: Content[][] = []

  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      teamId: stack.teamId,
      permissionMode: 'bypass',
      credentialAccess: { deviceIds: [deviceId] },
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    }),
  })
    .then(async (response) => response.text())
    .catch(() => undefined)
  await until('every call to answer', async () => {
    answers = agentLog(stack)
      .slice(from)
      .filter((item) => item.event === 'called')
      .map((item) => (item.result as { content?: Content[] } | undefined)?.content ?? [])

    return answers.length === calls.length
  })

  return answers
}

const textOf = (content: Content[]) => content.map((c) => c.text ?? '').join('\n')

function must(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
}

/** A page on this machine, whose second request is the one the recording must catch. */
async function servePage() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(
      request.url === '/next'
        ? '<title>E2E next</title><h1>next</h1>'
        : '<title>E2E headless page</title><h1 style="font-size:96px">Hello from nuphos agent</h1>',
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    close: () => server.close(),
  }
}

export const cliBrowserScenarios: Scenario[] = [
  {
    name: 'a computer running `nuphos agent` opens, screenshots and records a page headless',
    run: async (_page, stack) => {
      const site = await servePage()
      const computer = await startSecondComputer(stack, 'E2E headless browser')

      try {
        const [opened = [], shot = [], , , stopped = [], har = []] = await callAllOn(
          stack,
          computer.deviceId,
          [
            ['local_browser', { action: 'open', url: `${site.url}/` }],
            ['local_browser', { action: 'screenshot', tab: 1 }],
            ['local_browser', { action: 'record_start', tab: 1 }],
            ['local_browser', { action: 'navigate', tab: 1, url: `${site.url}/next` }],
            ['local_browser', { action: 'record_stop', tab: 1 }],
            ['local_exec', { command: 'cat "$NUPHOS_AGENT_HOME"/har/*.har' }],
          ],
        )

        must(
          textOf(opened).includes('E2E headless page'),
          `the page to open, got ${textOf(opened)}`,
        )
        const image = shot.find((c) => c.type === 'image')?.data ?? ''

        must(image.startsWith('/9j/'), `a JPEG screenshot to come back, got ${textOf(shot)}`)
        writeFileSync(join(artifacts, 'cli-browser-screenshot.jpg'), Buffer.from(image, 'base64'))
        must(
          textOf(stopped).includes('GET 200'),
          `record_stop to list the request, got ${textOf(stopped)}`,
        )
        // local_exec answers with the command's output under `stdout`.
        const file = (JSON.parse(textOf(har)) as { stdout?: string }).stdout ?? ''

        must(
          file.includes('"version":"1.2"') && file.includes(`${site.url}/next`),
          `the HAR to come back with the recorded request, got ${file.slice(0, 500)}`,
        )
      } finally {
        await computer.stop()
        forgetComputer(stack.mongoUri, computer.deviceId)
        site.close()
      }
    },
  },
]
