// A Box whose machine instabox is still pausing (#4094): its owner hears so, and it stays.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { boxRow, me } from './box-scenarios.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'

const STILL_PAUSING = 'The computer is still pausing. Try again in a minute.'

export const boxBusyScenarios: Scenario[] = [
  {
    // #4094: a Box whose suspend is still uploading said "try again in a few minutes" on
    // Resume, and a Delete dropped its row while the machine stayed at instabox.
    name: 'a Box still pausing says so on Resume and Delete, and stays',
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
      const label = `E2E Box ${deviceId.slice(0, 8)}`
      const userId = await me(stack)

      instaboxMachines.set(sandboxId, {
        id: sandboxId,
        state: 'running',
        operations: [],
        pausing: true,
      })
      boxRow(stack.mongoUri, {
        userId,
        deviceId,
        label,
        platform: 'linux',
        allowLocalExec: true,
        box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: userId },
        access: [{ teamId: stack.teamId, everyone: false, userIds: [], managerIds: [] }],
      })
      try {
        await openComputers(page)
        const card = page.getByText(label, { exact: true })

        await card.first().waitFor()
        await page.getByRole('button', { name: `Manage ${label}` }).click()
        await page.getByRole('menuitem', { name: 'Resume', exact: true }).click()
        await page.getByText('Could not resume computer').first().waitFor()
        await page.getByText(STILL_PAUSING).first().waitFor()
        await page.getByRole('button', { name: `Manage ${label}` }).click()
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete computer' }).click()
        await page.getByText('Could not delete computer').first().waitFor()
        await until(
          'Delete to say the computer is still pausing too',
          async () => (await page.getByText(STILL_PAUSING).count()) >= 2,
        )
        await page.screenshot({ path: join(artifacts, 'box-still-pausing.png') })
        if (!(await card.count())) throw new Error('A Box still pausing was deleted')
        if (!instaboxMachines.has(sandboxId)) throw new Error('Its machine went')
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        boxRow(stack.mongoUri, { remove: deviceId })
        instaboxMachines.delete(sandboxId)
      }
    },
  },
]
