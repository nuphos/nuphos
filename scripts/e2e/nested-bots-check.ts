// Throwaway check for #4325: 1 main Bot + 15 Bots nested under it, as listed by Desktop today.
import { writeFileSync } from 'node:fs'

import { client } from './binding-access-scenarios.ts'
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const helpers = Array.from({ length: 15 }, (_, i) => `Helper ${pad(i + 1)}`)
const names = ['Main Router', ...helpers]

export const nestedBotsCheck: Scenario[] = [
  {
    name: '#4325 check: Desktop Bots list with 1 main Bot and 15 nested Bots',
    run: async (page, stack) => {
      const out: Record<string, unknown> = {}
      const log = () => writeFileSync(`${artifacts}/nested-bots.json`, JSON.stringify(out, null, 2))
      try {
        const as = client(stack.apiUrl, stack.token)
        const ids: Record<string, string> = {}
        for (const title of names) {
          const r = await as('POST', '/agent/bots', { teamId: stack.teamId, title })
          ids[title] = (r.body as { sessionId: string }).sessionId
          out[`create ${title}`] = r.status
        }
        for (const h of helpers) {
          const r = await as('PUT', `/agent/conversations/${ids[h]}/parent`, {
            parentSessionId: ids['Main Router'],
            teamId: stack.teamId,
          })
          out[`parent ${h}`] = `${r.status} ${r.text}`
        }
        const listed = await as(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&bots=true&limit=50`,
        )
        out.apiBots = listed.body
        log()

        await page.reload()
        await page.getByRole('tab', { name: 'Bots' }).click()
        const panel = page.getByRole('tabpanel', { name: 'Bots' })
        await panel.getByText('Main Router', { exact: true }).first().waitFor()
        await page.waitForTimeout(1500)
        const vh = page.viewportSize()?.height ?? 0
        const count = async (label: string) => {
          const rows: Record<string, unknown> = {}
          const pins = panel.getByLabel('Pinned Bots')
          for (const n of names) {
            const all = panel.getByText(n, { exact: true })
            const total = await all.count()
            const pinned = (await pins.count()) ? await pins.getByText(n, { exact: true }).count() : 0
            const boxes = await Promise.all(
              Array.from({ length: total }, (_, i) => all.nth(i).boundingBox()),
            )
            rows[n] = { total, pinned, inList: total - pinned, onScreen: boxes.filter((b) => b && b.y + b.height <= vh && b.y >= 0).length }
          }
          out[label] = { viewport: page.viewportSize(), rows }
          log()
        }
        await count('beforePin')
        await page.screenshot({ path: `${artifacts}/nested-bots-1-before-pin.png` })

        await panel.getByText('Main Router', { exact: true }).first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Pin Bot' }).click()
        await panel.getByLabel('Pinned Bots').getByText('Main Router', { exact: true }).waitFor()
        await page.waitForTimeout(1500)
        await count('afterPin')
        await page.screenshot({ path: `${artifacts}/nested-bots-2-after-pin.png` })

        await page.getByRole('button', { name: 'Search' }).first().click()
        await page.keyboard.type('Helper 07')
        await page.waitForTimeout(3000)
        const dialog = page.getByRole('dialog')
        out.search = {
          'Helper 07': await dialog.getByText('Helper 07', { exact: true }).count(),
          otherHelpers: await dialog.getByText(/^Helper (?!07)/).count(),
          'Main Router': await dialog.getByText('Main Router', { exact: true }).count(),
          dialogText: (await dialog.innerText()).slice(0, 1500),
        }
        await page.screenshot({ path: `${artifacts}/nested-bots-3-search.png` })
        await page.keyboard.press('Escape')
      } catch (error) {
        out.error = String(error)
        await page.screenshot({ path: `${artifacts}/nested-bots-error.png` }).catch(() => {})
      } finally {
        log()
      }
    },
  },
]
