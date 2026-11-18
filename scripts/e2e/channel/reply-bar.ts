// #3542: opening a reply cut the Bot chat off under the reply bar. Runs in the Bot chat the
// scenarios before left open.
import { agentLog } from '../agent-log.ts'
import { artifacts, until } from '../processes.ts'

import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const TALL = 'every line of this note wraps, so the post is several lines tall. '.repeat(5)

/** The chat in front, its posts by text, the reply bar and the composer, in viewport pixels. */
const layout = (page: Page, post: string) =>
  page.evaluate((post) => {
    const front = (el: Element) => !el.closest('[inert]') && (el as HTMLElement).offsetParent
    const scroller = [...document.querySelectorAll<HTMLElement>('.header-edge.selectable')].find(
      front,
    )!
    const target = [...scroller.querySelectorAll('.group\\/post')].findLast((el) =>
      el.textContent?.includes(post),
    )
    const bar = [...document.querySelectorAll('[aria-label="Cancel reply"]')]
      .find(front)
      ?.closest('.rounded-xl')
    const composer = [...document.querySelectorAll('.composer-surface')].find(front)!
    const box = (el: Element | null | undefined) => {
      const rect = el?.getBoundingClientRect()

      return rect && { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    }

    return {
      fromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      scroller: box(scroller)!,
      post: box(target)!,
      bar: box(bar),
      composer: box(composer)!,
    }
  }, post)

async function reply(page: Page, post: string) {
  const row = page.locator('.group\\/post', { hasText: post }).last()

  await row.hover()
  await row.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel reply' }).waitFor()
}

/** Whole pixels: a subpixel layout rounds either way. */
const near = (a: number, b: number) => Math.abs(a - b) <= 1

const scenario: Scenario = {
  name: 'opening a reply leaves the chat whole above the reply bar, at its bottom or scrolled up',
  run: async (page, stack) => {
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('The Bot has not answered in its chat yet')
    for (let n = 1; n <= 8; n++) {
      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ teamId: stack.teamId, text: `Reply bar ${String(n)}: ${TALL}` }),
        },
      )

      if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
    }
    await page.getByText(/^Reply bar 8:/).waitFor()
    // Settled at the bottom: the newest post stays put between two looks.
    let last = -1

    await until('the chat to settle', async () => {
      const { fromBottom, post } = await layout(page, 'Reply bar 8:')
      const still = post.bottom === last && fromBottom <= 1

      last = post.bottom

      return still
    })

    // At the bottom: the chat stays there, its newest post whole above the bar.
    await reply(page, 'Reply bar 8:')
    const bottom = await layout(page, 'Reply bar 8:')

    await page.screenshot({ path: `${artifacts}/reply-bar-at-bottom.png` })
    if (bottom.fromBottom > 1 || bottom.post.bottom > bottom.scroller.bottom)
      throw new Error(`Replying at the bottom hid the newest post: ${JSON.stringify(bottom)}`)
    // The bar is the composer's width, so the chat's edge above it is the composer's own.
    if (
      !bottom.bar ||
      !near(bottom.bar.left, bottom.composer.left) ||
      !near(bottom.bar.right, bottom.composer.right)
    )
      throw new Error(`The reply bar is not as wide as the composer: ${JSON.stringify(bottom)}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cancel reply' }).waitFor({ state: 'hidden' })

    // Scrolled up, a post's end just above the edge: opening the bar keeps it in view.
    await page.evaluate(() => {
      const scroller = [...document.querySelectorAll<HTMLElement>('.header-edge.selectable')].find(
        (el) => !el.closest('[inert]') && el.offsetParent,
      )!
      const post = [...scroller.querySelectorAll('.group\\/post')].findLast((el) =>
        el.textContent?.includes('Reply bar 5:'),
      )!

      scroller.scrollTop +=
        post.getBoundingClientRect().bottom - (scroller.getBoundingClientRect().bottom - 4)
    })
    await page.waitForTimeout(300)
    const before = await layout(page, 'Reply bar 5:')

    // Far enough up that the chat no longer follows its bottom (AUTO_SCROLL_BOTTOM_THRESHOLD).
    if (before.fromBottom <= 48) throw new Error(`Not scrolled up: ${JSON.stringify(before)}`)
    await reply(page, 'Reply bar 5:')
    const open = await layout(page, 'Reply bar 5:')

    await page.screenshot({ path: `${artifacts}/reply-bar-scrolled-up.png` })
    if (open.post.bottom > open.scroller.bottom)
      throw new Error(`The reply bar cut the post being read: ${JSON.stringify({ before, open })}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cancel reply' }).waitFor({ state: 'hidden' })
    const closed = await layout(page, 'Reply bar 5:')

    // Closing it puts the chat back where it was.
    if (!near(closed.post.bottom, before.post.bottom))
      throw new Error(`Closing the reply moved the chat: ${JSON.stringify({ before, closed })}`)
  },
}

export default scenario
