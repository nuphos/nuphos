// #4261: a Task moved to an agent whose model read had failed opened an empty picker that
// said the list had not been reported yet, and trying again asked that computer nothing. A
// computer of its own runs the fixture agent as Codex, with discovery failing until let through.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { agentLog } from './agent-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { DESKTOP_DIR, startSecondComputer } from './second-computer.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'E2E Codex mini'
const PROBE_FAILS = join(artifacts, 'model-recovery-probe-fails')

/** The app's bundle with the fixture agent as the computer's own Codex. */
function codexBundle(stack: Stack): string {
  const real = join(DESKTOP_DIR, 'build', 'local-runtime', 'linux-x64')
  const root = join(artifacts, 'model-recovery-bundle')
  const adapter = join(root, 'adapters', 'codex')
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
  writeFileSync(
    join(adapter, 'agent.mjs'),
    [
      `process.env.E2E_ACP_LOG = ${JSON.stringify(stack.acpLog)}`,
      "process.env.E2E_AGENT = 'local-codex'",
      `process.env.E2E_RELEASE = ${JSON.stringify(join(artifacts, 'model-recovery-release'))}`,
      `process.env.E2E_HOLD_OPENING = ${JSON.stringify(join(artifacts, 'model-recovery-never'))}`,
      `process.env.E2E_MODEL_PROBE_FAILS = ${JSON.stringify(PROBE_FAILS)}`,
      `await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'acp-fixture.mjs')).href)})`,
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      adapters: { codex: { entry: 'agent.mjs', version: manifest.adapters.codex?.version } },
    }),
  )

  return root
}

/** The computer's own `codex`, installed and signed in; never a vendor's CLI. */
function codexHome(): string {
  const home = join(artifacts, 'model-recovery-home')
  const bin = join(home, '.local', 'bin')

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'codex'),
    [
      '#!/bin/sh',
      'case "$*" in',
      '  *--version*) echo "codex-cli 0.169.0" ;;',
      '  *login*status*) echo "Logged in using ChatGPT" ;;',
      '  *) exit 0 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )

  return home
}

const chip = (page: Page) => page.getByRole('button', { name: /^Model settings/ })
/** How often that computer has tried to read its agent's models. */
const reads = (stack: Stack) => agentLog(stack).filter(({ event }) => event === 'discovery').length

export const modelRecoveryScenarios: Scenario[] = [
  {
    name: 'a Task moved to a computer whose model read failed lists its models when the picker asks again',
    run: async (page, stack) => {
      writeFileSync(PROBE_FAILS, '')
      const home = codexHome()
      const computer = await startSecondComputer(stack, LABEL, {
        runtimeDir: codexBundle(stack),
        // Its own `codex` comes first, ahead of anything this runner has on its PATH.
        env: { HOME: home, PATH: `${join(home, '.local', 'bin')}:${process.env.PATH ?? ''}` },
      })

      try {
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
        await send(page, 'Before the move E2E_DELIVERY:model-recovery')
        await page.getByText('ACK E2E_DELIVERY:model-recovery').waitFor({ timeout: 60_000 })
        // The move a person makes: the computer's row in the runtime menu, then its Codex.
        await pickAgent(page, LABEL, 'Codex')
        await page.getByText('moved this task from E2E fixture agent to').waitFor({
          timeout: 60_000,
        })

        // Its models could not be read, and the picker says so rather than offering nothing
        // or promising a list in a moment.
        await chip(page).click()
        await page
          .getByText('Couldn’t load this runtime’s models', { exact: false })
          .waitFor({ timeout: 60_000 })
        await page.screenshot({ path: `${artifacts}/model-recovery-1-failed.png` })
        await page.keyboard.press('Escape')

        // Its CLI can list them again: the computer's own retry brings the list and the open
        // picker shows it. The picker's own ask is an IPC to the computer Desktop runs on, so
        // a second computer is not in that path; agent-models.test.ts covers it.
        rmSync(PROBE_FAILS, { force: true })
        const before = reads(stack)

        await until(
          'the computer to read its models again',
          async () => reads(stack) > before,
          240_000,
        )
        await chip(page).click()
        await page
          .getByRole('menuitemcheckbox', { name: /^fixture-small/ })
          .waitFor({ timeout: 60_000 })
        await page.screenshot({ path: `${artifacts}/model-recovery-2-listed.png` })
        await page.keyboard.press('Escape')
      } finally {
        rmSync(PROBE_FAILS, { force: true })
        await computer.stop()
        // Gone again, so the runtime lists later scenarios open are as long as before this one.
        forgetComputer(stack.mongoUri, computer.deviceId)
      }
    },
  },
]
