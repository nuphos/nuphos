// A real `nuphos agent` host whose Claude Code runtime runs the fixture agent, so its turns go
// through its tunnel: one whose path to the backend goes silent mid-turn and redials (#3366), and
// one whose owner updates it from its card mid-turn, which restarts it at once.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { agentEvents } from './agent-log.ts'
import { backendLines, backendLog } from './backend-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { DESKTOP_DIR, startSecondComputer } from './second-computer.ts'
import { proxyTo } from './tcp-proxy.ts'
import { newTask, openComputers, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'E2E patchy mini'
const UPDATED = 'E2E office mini'
const RELEASE = join(artifacts, 'tunnel-release')

/** The app's local-runtime bundle with the fixture agent as Claude Code; E2E_WAIT_RELEASE waits for `release`. */
function fixtureBundle(stack: Stack, name = 'tunnel', release = RELEASE): string {
  const real = join(DESKTOP_DIR, 'build', 'local-runtime', 'linux-x64')
  const root = join(artifacts, `${name}-bundle`)
  const neverFile = join(artifacts, `${name}-never`)
  const adapter = join(root, 'adapters', 'claude-code')
  const manifest = JSON.parse(readFileSync(join(real, 'manifest.json'), 'utf8')) as {
    adapters: Record<string, { version: string }>
  }

  // Copies, not links: the bundle's scripts run only when started by their own path.
  cpSync(real, root, {
    recursive: true,
    filter: (source) => !source.startsWith(join(real, 'adapters')) || source === real,
  })
  mkdirSync(adapter, { recursive: true })
  cpSync(
    join(real, 'adapters', 'claude-code', 'mcp-http-bridge.mjs'),
    join(adapter, 'mcp-http-bridge.mjs'),
  )
  // OpenAB passes the adapter only the runtime's own environment, so the fixture's is set here.
  writeFileSync(
    join(adapter, 'agent.mjs'),
    [
      `process.env.E2E_ACP_LOG = ${JSON.stringify(stack.acpLog)}`,
      `process.env.E2E_AGENT = ${JSON.stringify(name)}`,
      `process.env.E2E_RELEASE = ${JSON.stringify(release)}`,
      `process.env.E2E_HOLD_OPENING = ${JSON.stringify(neverFile)}`,
      `await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'acp-fixture.mjs')).href)})`,
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      adapters: {
        'claude-code': { entry: 'agent.mjs', version: manifest.adapters['claude-code']?.version },
      },
    }),
  )

  return root
}

/** Adds Claude Code to `label` as a person does (the installer is the fixture's), and starts a Task there. */
async function newTaskOn(page: Page, label: string) {
  await openComputers(page)
  await page.getByRole('button', { name: `New runtime on ${label}` }).click()
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  const code = page.getByPlaceholder('Paste code')

  await code.waitFor({ timeout: 60_000 })
  await code.fill('e2e-code#e2e-state')
  await page.keyboard.press('Enter')
  await page.getByText(/is now signed in/).waitFor({ timeout: 60_000 })
  await page.getByText('Back to app', { exact: true }).click()

  await newTask(page)
  // The computer's row opens its runtimes, named by agent alone.
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await page.getByRole('menu').getByText(label).click()
  await page.getByRole('menuitem', { name: /^Claude Code/ }).click()
}

/** Lines the backend logged about this computer since `from`. */
const about = (deviceId: string, from: number) =>
  backendLog(from).filter((line) => line.includes(`"device_id":"${deviceId}"`))

export const tunnelScenarios: Scenario[] = [
  {
    // #3366: Yuanlin's Mac mini. Each redial failed every turn in flight with no_presence.
    name: 'a computer whose network goes silent mid-turn redials, and the turn ends there',
    run: async (page, stack) => {
      const proxy = await proxyTo(Number(new URL(stack.apiUrl).port))
      const computer = await startSecondComputer(stack, LABEL, {
        apiUrl: proxy.url,
        runtimeDir: fixtureBundle(stack),
      })

      try {
        await newTaskOn(page, LABEL)
        await send(page, 'Over its tunnel E2E_DELIVERY:tunnel-before')
        await page.getByText('ACK E2E_DELIVERY:tunnel-before').waitFor({ timeout: 60_000 })

        await send(page, 'Across a redial E2E_WAIT_RELEASE E2E_DELIVERY:tunnel-during')
        await until('the turn to start on the computer', async () =>
          agentEvents(stack).includes('start E2E_DELIVERY:tunnel-during'),
        )
        const from = backendLines()

        // Nothing the backend sends reaches the computer now, so after its idle timeout it gives
        // the socket up and dials again, which the proxy passes.
        proxy.silenceOpenConnections()
        await until(
          'the computer to give up its silent tunnel and take the computer over',
          async () => {
            const lines = about(computer.deviceId, from)

            return (
              lines.some((line) => line.includes('"reason":"idle"') && line.includes('desktop')) &&
              lines.some((line) => line.includes('"code":4000'))
            )
          },
        )
        writeFileSync(RELEASE, '')
        await page.getByText('ACK E2E_DELIVERY:tunnel-during').waitFor({ timeout: 60_000 })

        const lines = about(computer.deviceId, from)
        const opened = lines.findIndex((line) => line.includes('tunnel_opened'))
        const takenOver = lines.findIndex((line) => line.includes('"code":4000'))

        // The new tunnel came up while the old one still held the computer, then took it over.
        if (opened < 0 || takenOver < opened)
          throw new Error(`The redial did not take the old tunnel over:\n${lines.join('\n')}`)
        const failed = lines.filter((line) => line.includes('agent.local_runtime.stream_failed'))

        if (failed.length > 0)
          throw new Error(`A stream failed across the redial:\n${failed.join('\n')}`)
      } finally {
        await computer.stop()
        proxy.close()
        // Gone again, so a later Task's "Select all" finds only the computers it did before.
        forgetComputer(stack.mongoUri, computer.deviceId)
      }
    },
  },
  {
    // Yuanlin's Mac mini: Update waited for its running Tasks, so it never started.
    name: 'Update on another computer restarts it at once, and the turn running there ends',
    run: async (page, stack) => {
      const computer = await startSecondComputer(stack, UPDATED, {
        // Never released: the turn is still running when the host stops.
        runtimeDir: fixtureBundle(stack, 'update', join(artifacts, 'update-never')),
        stagedUpdate: '9.9.9',
      })

      try {
        await newTaskOn(page, UPDATED)
        await send(page, 'Before the update E2E_DELIVERY:update-before')
        await page.getByText('ACK E2E_DELIVERY:update-before').waitFor({ timeout: 60_000 })

        await send(page, 'A long turn E2E_WAIT_RELEASE E2E_DELIVERY:update-during')
        await until('the long turn to start on the computer', async () =>
          agentEvents(stack).includes('start E2E_DELIVERY:update-during'),
        )

        await openComputers(page)
        const card = page.getByRole('listitem').filter({ hasText: UPDATED })

        await card.getByRole('button', { name: 'Update available' }).click()
        const dialog = page.getByRole('dialog')

        await dialog.getByText(`Update ${UPDATED}?`).waitFor()
        await page.screenshot({ path: join(artifacts, 'computer-update-confirm.png') })
        await dialog.getByRole('button', { name: 'Update and restart' }).click()
        // It used to answer "An agent is working on this computer" and leave the turn running.
        await until('the computer to restart into its update', async () => computer.restarts() > 0)
        await page.getByText(`${UPDATED} is back`).waitFor({ timeout: 120_000 })
        await page.getByText('Back to app', { exact: true }).click()

        // The turn the restart ended stops running, and the Task carries on there.
        await until(
          'the Task to stop running',
          async () => (await page.locator('button[title="Stop"]').count()) === 0,
          120_000,
        )
        await page.screenshot({ path: join(artifacts, 'computer-update-task-after.png') })
        await send(page, 'After the update E2E_DELIVERY:update-after')
        await page.getByText('ACK E2E_DELIVERY:update-after').waitFor({ timeout: 60_000 })
      } finally {
        await computer.stop()
        // Gone again, so a later Task's "Select all" finds only the computers it did before.
        forgetComputer(stack.mongoUri, computer.deviceId)
      }
    },
  },
]
