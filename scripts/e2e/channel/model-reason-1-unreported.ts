// #3807: a Bot moved to a computer whose agent had not reported its models was told to send a
// message first. Its model menu now says the computer has not reported them yet.
import { randomUUID } from 'node:crypto'

import { computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { artifacts } from '../processes.ts'
import { settingButton } from '../ui.ts'

import type { Scenario } from '../ui.ts'

export default {
  name: 'a Bot moved to a computer that has not reported its models says so in its model menu',
  run: async (page, stack) => {
    const computer = 'E2E unreported computer'
    const deviceId = randomUUID()
    // Its Claude Code is signed in and has reported no model list.
    const disconnect = await computerWithUsage(stack, computer, deviceId)

    try {
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await pickRuntime(page, computer, /^Claude Code/)
      await (await settingButton(page, /^Model settings/)).click()
      await page
        .getByText('This computer hasn’t reported its models yet.', { exact: false })
        .waitFor()
      await page.screenshot({ path: `${artifacts}/model-reason-unreported.png` })
      await page.keyboard.press('Escape')
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
    } finally {
      disconnect()
      // Gone again, so the runtime lists later scenarios open are as long as before this one.
      await fetch(`${stack.apiUrl}/agent/devices/${deviceId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${stack.token}` },
      })
    }
  },
} satisfies Scenario
