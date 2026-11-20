// Opening a Box's desktop from Desktop. instabox makes desktop links only for the machine's
// creator, never for a workspace key such as the deployment's, so the desktop comes over
// instabox's own VNC through the backend (the stub refuses links exactly as instabox does).
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { boxRow, me } from './box-scenarios.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'

export const boxDesktopScenarios: Scenario[] = [
  {
    // A workspace key, as the deployment's is, may not make desktop links (#4100): the desktop
    // opens over instabox's own VNC instead, and paints.
    name: "a Box's desktop opens from Desktop over instabox's VNC, without a desktop link",
    run: async (page, stack) => {
      const deviceId = randomUUID()
      const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
      const label = `E2E Desktop Box ${deviceId.slice(0, 8)}`
      const userId = await me(stack)

      instaboxMachines.set(sandboxId, { id: sandboxId, state: 'running', operations: [] })
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
        await page.getByRole('button', { name: `Manage ${label}` }).click()
        await page.getByRole('menuitem', { name: 'Open desktop' }).click()
        // The stub's colour bars on the 1280×800 canvas, not a blank or failed view.
        await until("the Box's desktop to paint", () =>
          page.evaluate(() => {
            const canvas = [...document.querySelectorAll('canvas')].find(
              (each) => each.width === 1280 && each.height === 800,
            )

            if (!canvas || canvas.clientWidth === 0) return false
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, 1280, 800).data
            const colours = new Set<string>()

            for (let i = 0; i < pixels.length; i += 4 * 997)
              if (pixels[i + 3])
                colours.add(
                  `${String(pixels[i])},${String(pixels[i + 1])},${String(pixels[i + 2])}`,
                )

            return colours.size >= 6
          }),
        )
        await page.screenshot({ path: join(artifacts, 'box-desktop-vnc.png') })
        await page
          .getByRole('button', { name: /^Close tab (Desktop|E2E Desktop Box)/u })
          .first()
          .click()
      } finally {
        boxRow(stack.mongoUri, { remove: deviceId })
        instaboxMachines.delete(sandboxId)
      }
    },
  },
]
