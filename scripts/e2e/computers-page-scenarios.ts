// The Computers page's own toolbar: what its search searches.
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'

export const computersPageScenarios: Scenario[] = [
  {
    // #3786: "2 items" beside the search counted the runtimes below the fold, not the computers.
    name: 'the Computers page search says it searches runtimes, and finds one',
    run: async (page) => {
      await openComputers(page)
      const search = page.getByRole('textbox', { name: 'Search runtimes' })
      const runtimes = page.getByRole('region', { name: 'Runtimes' })
      const rows = runtimes.getByRole('button')

      await search.waitFor()
      if ((await search.getAttribute('placeholder')) !== 'Search runtimes')
        throw new Error('The search does not say what it searches')
      await until('a runtime to be listed', async () => (await rows.count()) > 0)
      // The cards fade in; the picture is taken once they have.
      await page.waitForTimeout(1_500)
      await page.screenshot({ path: join(artifacts, 'computers-toolbar.png') })
      const name = (await rows.first().locator('.font-medium').innerText()).trim()

      await search.fill(name)
      await rows.first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(artifacts, 'computers-search-runtimes.png') })
      if (!(await rows.first().innerText()).includes(name))
        throw new Error(`Searching for ${name} did not list it`)
      await search.fill('')
      await page.getByText('Back to app', { exact: true }).click()
    },
  },
]
