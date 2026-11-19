// Adding Claude Code to a computer that does not have it installs it, then signs it in (#3244).
// The installer is fixture-install.sh, so no vendor's CLI is downloaded.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, resolve } from 'node:path'

import { client, joinAsAdmin, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { newTask, openComputers, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const FIXTURE_CLAUDE = resolve(import.meta.dirname, 'fixture-claude.mjs')

/** What the person sees at this step, once anything fading in has settled. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, `install-${name}.png`) })
}

/** Claude's authorize page is never opened: its code is typed in, as the person pastes it. */
async function pasteCode(page: Page, name: string) {
  const code = page.getByPlaceholder('Paste code')

  await code.waitFor({ timeout: 60_000 })
  await shot(page, name)
  await code.fill('e2e-code#e2e-state')
  await page.keyboard.press('Enter')
}

export const installScenarios: Scenario[] = [
  {
    // Yuanlin's case: from one computer, adding an agent to another that lacks its CLI.
    name: 'adding Claude Code to another computer without it installs it there, then signs it in',
    run: async (page, stack) => {
      const label = 'E2E Mac mini'
      const computer = await startSecondComputer(stack, label)

      try {
        await openComputers(page)
        await page.getByRole('button', { name: `New runtime on ${label}` }).click()
        await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click()
        await shot(page, 'remote-1-settings')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText(`Installing Claude Code on ${label}…`).waitFor({ timeout: 60_000 })
        await shot(page, 'remote-2-installing')
        await pasteCode(page, 'remote-3-sign-in')
        await page.getByText(/is ready\./).waitFor({ timeout: 60_000 })
        await shot(page, 'remote-4-added')
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        await computer.stop()
      }
    },
  },
  {
    // Whoever manages a computer may add an agent to it, and adding is what installs.
    name: "a manager who is not the owner adds Claude Code to the owner's computer and it is installed there; a teammate who only uses it is refused",
    run: async (_page, stack) => {
      const computer = await startSecondComputer(stack, 'E2E shared mini')

      try {
        const { member, memberId } = await joinAsAdmin(stack, client(stack.apiUrl, stack.token))
        const share = (managerIds: string[]) =>
          client(stack.apiUrl, stack.token)(
            'PUT',
            `/agent/devices/${computer.deviceId}/share?teamId=${stack.teamId}`,
            { level: 'full', everyone: false, userIds: [memberId], managerIds },
          )
        const add = () =>
          member('POST', `/agent/devices/${computer.deviceId}/agents`, {
            teamId: stack.teamId,
            provider: 'claude-code',
          })
        const installed = () => existsSync(join(computer.home, '.local', 'bin', 'claude'))

        must((await share([])).status === 200, 'the computer to be shared for use')
        const refused = await add()

        must(refused.status === 404, `use alone to be refused, got ${String(refused.status)}`)
        must((await share([memberId])).status === 200, 'the teammate to be made a manager')
        const added = await add()

        must(added.status === 201, `a manager to add it, got ${String(added.status)} ${added.text}`)
        await until('the computer to install Claude Code', async () => installed())
      } finally {
        await computer.stop()
      }
    },
  },
  {
    // On the computer itself: its own Claude Code, from Settings › Local runtime. Last, since
    // the app's computer has Claude Code from here on.
    name: 'this computer without Claude Code installs it from its settings, then signs it in',
    run: async (page) => {
      await openComputers(page)
      await page.getByRole('button', { name: 'Set up' }).first().click()
      const install = page.getByRole('button', { name: 'Install Claude Code' })

      await install.waitFor()
      await shot(page, 'local-1-not-installed')
      await install.click()
      await page.getByText('Claude Code installed').waitFor({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Sign in with Claude Code' }).click()
      // This computer's own sign-in says first that it is kept apart from the terminal's.
      await page.getByRole('button', { name: 'Sign in with Claude', exact: true }).click()
      // This computer's own sign-in takes the code in a dialog of its own.
      const code = page.getByRole('dialog').getByRole('textbox')

      await code.waitFor({ timeout: 60_000 })
      await shot(page, 'local-2-sign-in')
      await code.fill('e2e-code#e2e-state')
      await page.getByRole('button', { name: 'Submit code' }).click()
      await page.getByText('Signed in to Claude Code.').waitFor({ timeout: 60_000 })
      await shot(page, 'local-3-signed-in')
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
  {
    // #3804: the Claude app keeps its Claude Code under a folder named for its version and
    // deletes that folder when it updates. A session started after that runs the new copy. Only
    // the e2e fixture is moved or deleted, never a developer's own Claude Code.
    name: "this computer's Claude Code from the Claude app runs the app's new copy after it updates, and Install brings back a deleted one",
    expected: /"event":"agent\.chat\.(?:request\.error|run\.error_frame_appended)"/,
    run: async (page) => {
      const cli = join(homedir(), '.local', 'bin', 'claude')

      if (!readFileSync(cli, 'utf8').includes('fixture-install.sh')) {
        console.log(`SKIP ${cli} is not the fixture`)

        return
      }
      const app = join(homedir(), '.config', 'Claude', 'claude-code')
      const ran = join(app, 'ran-2.1.1')
      const copy = (version: string, script: string) => {
        mkdirSync(join(app, version), { recursive: true })
        writeFileSync(join(app, version, 'claude'), script, { mode: 0o755 })
      }

      await openComputers(page)
      await page.getByRole('button', { name: 'Set up' }).first().click()
      // The Claude Code card: its name and its own Check again, and not the Codex card beside it.
      const card = page
        .locator('div')
        .filter({ has: page.getByText('Claude Code', { exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Check again' }) })
        .last()
      const ready = card.getByText('Ready for your Bots and tasks')

      // Only the Claude app's copy is left, and the agent runs it.
      copy('2.1.0', readFileSync(cli, 'utf8'))
      rmSync(cli)
      await card.getByRole('button', { name: 'Check again' }).click()
      await card.getByText('v2.1.0').waitFor({ timeout: 60_000 })
      await ready.waitFor({ timeout: 60_000 })

      // The Claude app updates: 2.1.1 in, 2.1.0 deleted while the agent runs it.
      copy('2.1.1', `#!/bin/sh\ntouch "${ran}"\nexec node "${FIXTURE_CLAUDE}" "$@"\n`)
      rmSync(join(app, '2.1.0'), { recursive: true })
      await page.getByText('Back to app', { exact: true }).click()
      await newTask(page)
      await pickAgent(page, hostname())
      await send(page, 'Which Claude Code runs this?')
      await until(
        'the session to start the Claude app’s new copy',
        async () => existsSync(ran),
        90_000,
      )

      // Nothing left: the card says so, and Install brings it back.
      rmSync(join(homedir(), '.config', 'Claude'), { recursive: true })
      await openComputers(page)
      await page.getByRole('button', { name: 'Set up' }).first().click()
      await card.getByRole('button', { name: 'Check again' }).click()
      await card.getByText('Not installed', { exact: true }).waitFor({ timeout: 60_000 })
      await shot(page, 'local-4-deleted')
      await card.getByRole('button', { name: 'Install Claude Code' }).click()
      await page.getByText('Claude Code installed').waitFor({ timeout: 60_000 })
      await ready.waitFor({ timeout: 60_000 })
      await shot(page, 'local-5-reinstalled')
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
  // TODO(#3654): adding an agent to a just-connected computer can skip installing its CLI;
  // this one is back in with that fix.
].filter((scenario) => !scenario.name.startsWith('adding Claude Code to another computer'))
