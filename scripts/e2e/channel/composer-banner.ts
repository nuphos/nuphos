// #3567: a banner above the composer (a computer's disk almost full) covered the Bot chat's newest
// post. The chat keeps room for it: at its end, the newest post stays whole above the banner.
import { computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'

import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const COMPUTER = 'E2E full-disk computer'

/** The chat in front, scrolled to its end: its distance from it, newest post's end, banner's top. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const front = (el: Element) => !el.closest('[inert]') && (el as HTMLElement).offsetParent
    const scroller = [...document.querySelectorAll<HTMLElement>('.header-edge.selectable')].find(
      front,
    )!

    scroller.scrollTop = scroller.scrollHeight
    const newest = [...scroller.querySelectorAll('.group\\/post')].at(-1)
    const banner = [...document.querySelectorAll('[role="status"]')].find(
      (el) => front(el) && el.textContent?.includes('almost full'),
    )

    return {
      fromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      newest: newest?.getBoundingClientRect().bottom ?? Infinity,
      banner: banner?.getBoundingClientRect().top ?? null,
    }
  })

const scenario: Scenario = {
  name: "a banner above the composer leaves the Bot chat's newest post whole above it",
  run: async (page, stack) => {
    await page.getByRole('tab', { name: 'Bots' }).click()
    await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
    // As in the offline banner's scenario, the idle Bot moves to a computer whose disk is almost
    // full; its banner opens over the chat's end. Nothing is posted: a turn there would never end.
    const forget = await computerWithUsage(stack, COMPUTER, undefined, 92)

    try {
      // Diagnostic: exercise the same hover and click a person uses, without the menu helper.
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      const computer = page.getByRole('menuitem').filter({ hasText: COMPUTER }).first()
      await computer.hover()
      const agent = page.getByRole('menuitem', { name: /^Claude Code/ }).last()
      await agent.waitFor({ state: 'visible', timeout: 30_000 })
      await page.screenshot({ path: `${artifacts}/4349-hover-open.png` })
      await page.waitForTimeout(2_000)
      if (!(await agent.isVisible())) throw new Error('4349: submenu closed before pointer selection')
      await agent.click()
      await page.getByRole('button', { name: /^Runtime: .*E2E full-disk computer/ }).waitFor()
      await page.screenshot({ path: `${artifacts}/4349-pointer-selected.png` })
      console.log('4349 POINTER: selected Claude Code on full-disk computer')
      await page
        .getByText(/disk is almost full/)
        .first()
        .waitFor({ timeout: 90_000 })
      let last = -1

      await until('the chat to settle at its end', async () => {
        const { fromBottom, newest } = await layout(page)
        const still = newest === last && fromBottom <= 1

        last = newest

        return still
      })
      const shown = await layout(page)

      const themed = await page.evaluate(() => {
        const was = document.documentElement.className

        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')

        return was
      })

      await page.screenshot({ path: `${artifacts}/composer-banner-light.png` })
      await page.evaluate((was) => {
        document.documentElement.className = was
      }, themed)
      if (shown.banner === null) throw new Error('No disk banner above the composer')
      if (shown.newest > shown.banner + 1)
        throw new Error(`The banner covers the newest post: ${JSON.stringify(shown)}`)
      await pickRuntime(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
    } finally {
      forget()
    }
  },
}

export default scenario
