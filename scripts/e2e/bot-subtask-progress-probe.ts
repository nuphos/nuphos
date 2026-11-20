// Probe, not a check: what a Bot's chat shows while one sub-Task works and nothing else does.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { artifacts } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const botSubtaskProgressProbe: Scenario[] = [
  {
    name: 'PROBE: what the Bot chat says while one sub-Task works',
    run: async (page) => {
      const bots = page.getByRole('tabpanel', { name: 'Bots' })
      const bot = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      const release = join(artifacts, 'release')
      const titlebar = page.locator('.workspace-agent-titlebar').first()
      const look = async (when: string) => {
        const header = (await titlebar.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const posts = await page.locator('[data-post-id]').count()
        const last = await page
          .locator('[data-post-id]')
          .last()
          .innerText()
          .catch(() => '')

        console.log(
          `PROBE ${when} | titlebar: ${JSON.stringify(header)} | posts: ${String(posts)} | last: ${JSON.stringify(last.replace(/\s+/g, ' ').trim().slice(0, 160))}`,
        )
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/probe-${when}-light.png` })
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      await bot.click()
      rmSync(release, { force: true })
      try {
        await look('before')
        await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:unlisted-probe')
        // The sub-Task is held until `release`, so this is the whole window the user sees:
        // the Bot's own turn is over and one sub-Task is working.
        for (const seconds of [3, 8, 15, 25]) {
          await page.waitForTimeout(seconds * 1000)
          await look(`held-${String(seconds)}s`)
        }
      } finally {
        writeFileSync(release, '')
      }
      await page.waitForTimeout(10_000)
      await look('after')
      rmSync(release, { force: true })
    },
  },
]
