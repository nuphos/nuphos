// #3567: a banner above the composer (a computer's disk almost full) covered the Bot chat's newest
// post. The chat keeps room for it: at its end, the newest post stays whole above the banner.
import { agentEvents, agentLog } from '../agent-log.ts'
import { computerWithUsage, pickRuntime } from '../channel-helpers.ts'
import { artifacts, until } from '../processes.ts'

import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const TALL = 'every line of this note wraps, so the post is several lines tall. '.repeat(4)
const COMPUTER = 'E2E full-disk computer'

/** The chat in front: how far it is from its end, its newest post's end and the banner's top, in px. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const front = (el: Element) => !el.closest('[inert]') && (el as HTMLElement).offsetParent
    const scroller = [...document.querySelectorAll<HTMLElement>('.header-edge.selectable')].find(
      front,
    )!
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
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('The Bot has not answered in its chat yet')
    await page.getByRole('tab', { name: 'Bots' }).click()
    await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
    const before = agentEvents(stack).length
    // A tall exchange first, while the Bot still answers on the fixture.
    const posted = await fetch(
      `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: stack.teamId, text: `Banner check: ${TALL}` }),
      },
    )

    if (!posted.ok) throw new Error(`Posting failed: ${String(posted.status)}`)
    await until('the Bot to answer', async () =>
      agentEvents(stack)
        .slice(before)
        .some((event) => event.startsWith('finish')),
    )
    // Then the Bot moves to a computer whose disk is almost full: its banner opens over the chat's end.
    const forget = await computerWithUsage(stack, COMPUTER, undefined, 92)

    try {
      await pickRuntime(page, COMPUTER, /^Claude Code/)
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
