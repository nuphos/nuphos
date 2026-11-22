// #3542: the reply bar cut the Bot chat off along a hard line at its top. Runs in the Bot chat the
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
      // The dots stay in the DOM, folded away, once the turn ends: only open ones count.
      working: scroller.querySelector('[data-open="true"] .t-typing-dot') !== null,
      scroller: box(scroller)!,
      post: box(target)!,
      bar: box(bar),
      composer: box(composer)!,
    }
  }, post)

async function reply(page: Page, post: string) {
  const row = page.locator('.group\\/post:visible', { hasText: post }).last()

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
    const wakes = () =>
      agentLog(stack).filter((entry) => entry.event === 'channel' && entry.detail === channelId)
        .length
    const woken = wakes()

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
    // The posts wake the Bot, and its answers land below them as they come: wait for its turn to
    // end, or opening the reply races a post arriving under it.
    await until('the Bot to read the posts', async () => wakes() > woken)
    // Settled at the bottom: the Bot done, the newest post stays put between two looks.
    let last = -1

    await until('the chat to settle', async () => {
      const { fromBottom, post, working } = await layout(page, 'Reply bar 8:')
      const still = post.bottom === last && fromBottom <= 1 && !working

      last = post.bottom

      return still
    })

    // At the bottom: the chat stays there, its newest post whole above the bar.
    await reply(page, 'Reply bar 8:')
    const bottom = await layout(page, 'Reply bar 8:')
    const bar = bottom.bar

    await page.screenshot({ path: `${artifacts}/reply-bar-at-bottom.png` })
    if (!bar) throw new Error('No reply bar')
    if (bottom.fromBottom > 1 || bottom.post.bottom > bar.top)
      throw new Error(`Replying at the bottom hid the newest post: ${JSON.stringify(bottom)}`)
    // The bar keeps its place: just above the composer, a face (38px) in from each side.
    if (
      !near(bar.bottom, bottom.composer.top) ||
      !near(bar.left - bottom.composer.left, 38) ||
      !near(bottom.composer.right - bar.right, 38)
    )
      throw new Error(`The reply bar moved: ${JSON.stringify(bottom)}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cancel reply' }).waitFor({ state: 'hidden' })

    // Scrolled up, a post's end just above the composer: the bar floats over the chat,
    // which runs on under it to the composer, with no edge at the bar's top.
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
    if (!open.bar || !near(open.scroller.bottom, open.composer.top))
      throw new Error(`The chat ends at the reply bar: ${JSON.stringify({ before, open })}`)
    if (!near(open.post.bottom, before.post.bottom))
      throw new Error(`Opening the reply moved the chat: ${JSON.stringify({ before, open })}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cancel reply' }).waitFor({ state: 'hidden' })
    const closed = await layout(page, 'Reply bar 5:')

    if (!near(closed.post.bottom, before.post.bottom))
      throw new Error(`Closing the reply moved the chat: ${JSON.stringify({ before, closed })}`)
  },
}

export default scenario
