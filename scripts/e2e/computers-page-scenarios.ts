// The Computers page's own toolbar: what its search searches.
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Locator } from 'playwright-core'

/** Whether the input's placeholder is drawn whole, measured in its own font. */
const placeholderFits = (input: Locator) =>
  input.evaluate((element) => {
    const box = element as HTMLInputElement
    const style = getComputedStyle(box)
    const context = document.createElement('canvas').getContext('2d')!

    context.font = style.font
    const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)

    return context.measureText(box.placeholder).width <= room
  })

export const computersPageScenarios: Scenario[] = [
  {
    // #3786: "2 items" beside the search counted the runtimes below the fold, not the computers.
    name: 'the Computers page search says it searches runtimes, whole at any width, and finds one',
    run: async (page) => {
      await openComputers(page)
      const search = page.getByRole('textbox', { name: 'Search runtimes' })
      const runtimes = page.getByRole('region', { name: 'Runtimes' })
      const rows = runtimes.getByRole('button')
      const size = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))

      await search.waitFor()
      if ((await search.getAttribute('placeholder')) !== 'Runtimes')
        throw new Error('The search does not say what it searches')
      await until('a runtime to be listed', async () => (await rows.count()) > 0)
      // The cards fade in; the picture is taken once they have.
      await page.waitForTimeout(1_500)
      await page.screenshot({ path: join(artifacts, 'computers-toolbar.png') })
      if (!(await placeholderFits(search))) throw new Error('The search placeholder is cut off')
      // The app's narrowest window.
      await page.setViewportSize({ width: 900, height: size.height })
      try {
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'computers-toolbar-900.png') })
        if (!(await placeholderFits(search)))
          throw new Error('The search placeholder is cut off at 900 px')
      } finally {
        await page.setViewportSize(size)
      }
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
