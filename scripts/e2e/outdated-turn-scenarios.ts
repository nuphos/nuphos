// A turn that fails on a computer with a Nuphos update waiting. In Slack and channels, where no
// banner shows, the failed turn's own line is the only notice (#3562).
import { join } from 'node:path'

import { LAPTOP, RESTORE_FAILED, laptopOnline } from './laptop-fixture.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickAgent, pickInRow, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

// What the conversation shows for a failed turn there: its summary, then the out-of-date line.
export const OUTDATED_LINE =
  "The agent failed before it could answer. Nuphos Desktop on E2E laptop is out of date. The downloaded update is ready. Quit Nuphos fully (⌘Q on a Mac) and reopen it to install it. If it doesn't close, quit it again."

export const NOT_READY_LINE =
  "The agent failed before it could answer. Nuphos Desktop on E2E laptop is out of date. Open Settings → Updates to get the update, then quit Nuphos fully (⌘Q on a Mac) and reopen it. If it doesn't close, quit it again."

// A new task starts on the runtime the last message went to, so send one on the fixture agent,
// after Desktop stops retrying the laptop's failed turn (#4394). Only this chat's Stop counts:
// chats opened before stay mounted, hidden.
export async function backOnFixture(page: Page, marker: string) {
  await until(
    'the turn to stop retrying',
    async () =>
      (await page.locator('button[title="Stop"]').filter({ visible: true }).count()) === 0,
  )
  await newTask(page)
  await pickAgent(page, 'E2E fixture agent')
  await send(page, `Back on the fixture E2E_DELIVERY:${marker}`)
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()
}

export const outdatedTurnScenarios: Scenario[] = [
  {
    // #3562: a Desktop below the floor with an update downloaded says the update is ready. At or
    // above the floor a failed turn keeps its own error (#4630).
    name: 'a turn that fails on a computer below the floor with an update waiting says to update it',
    // The turn there fails on purpose.
    expected: new RegExp(RESTORE_FAILED),
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.123.0',
        app: { version: '0.123.0', update: { version: '0.131.0', ready: true } },
        restoreFails: true,
      })

      try {
        // A new task starts on the laptop, whichever runtime the last one used.
        await newTask(page)
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await pickInRow(page, LAPTOP, /Claude Code/)
        await send(page, 'On the laptop behind the latest release')
        await page.getByText(OUTDATED_LINE).waitFor()
        await page.screenshot({ path: join(artifacts, 'behind-turn-error.png') })
        // Use only APIs already present in Desktop 0.123, so the packaged-old-client
        // verification exercises its unchanged chat renderer as well as its Task renderer.
        await page.evaluate(async (teamId) => {
          const runtimes = await window.api.atlasListRuntimeInstances(teamId)
          const runtime = runtimes.find((item) => item.local?.deviceId === 'e2e-laptop')

          if (!runtime) throw new Error('The old laptop runtime was not listed')
          const bot = await window.api.agentCreateBot(teamId, {
            title: 'Update reminder',
            runtimeId: runtime.id,
            agentRuntime: 'claude-code',
          })
          const chat = await window.api.agentCreateChannel(teamId)

          await window.api.agentAddChannelAgent(chat.sessionId, teamId, bot.sessionId)
          await window.api.agentWakeChannelAgent(chat.sessionId, teamId, bot.sessionId)
        }, stack.teamId)
        await page.reload()
        await page.getByRole('tab', { name: /^Bots/ }).click()
        await page
          .locator('[data-sidebar-row]')
          .filter({ hasText: 'Update reminder' })
          .first()
          .click()
        await send(page, 'Explain the update waiting on this computer')
        await page
          .getByText(/couldn’t reply:.*Nuphos Desktop on E2E laptop is out of date/)
          .waitFor()
        await page
          .getByText(/The downloaded update is ready\. Quit Nuphos fully/)
          .last()
          .waitFor()
        await page.screenshot({ path: join(artifacts, 'behind-bot-error.png') })
        await backOnFixture(page, 'after-behind')
      } finally {
        goOffline()
      }
    },
  },
  {
    name: 'an old Desktop without a staged update points to Settings Updates',
    expected: new RegExp(RESTORE_FAILED),
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.123.0',
        app: { version: '0.123.0' },
        restoreFails: true,
      })

      try {
        await newTask(page)
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await pickInRow(page, LAPTOP, /Claude Code/)
        await send(page, 'How to get the update')
        await page.getByText(NOT_READY_LINE).waitFor()
        await page.screenshot({ path: join(artifacts, 'not-ready-turn-error.png') })
        await backOnFixture(page, 'after-not-ready')
      } finally {
        goOffline()
      }
    },
  },
]
