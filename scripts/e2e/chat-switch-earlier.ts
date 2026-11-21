import type { Page } from 'playwright-core'

// As many as a Bot chat reads: it opens with the latest 30 drawn, as a Task does (#4382).
export const LONG_POSTS = 200
const DRAWN = 30

/** A long Bot chat draws its latest posts, and the rest on request with the first one kept in view. */
export async function loadEarlier(page: Page, title: string) {
  const posts = page
    .locator('[data-post-id]')
    .filter({ visible: true })
    .filter({ hasText: `${title} post ` })
  const drawn = await posts.count()

  if (drawn !== DRAWN) throw new Error(`${title} opened with ${String(drawn)} posts drawn`)
  const button = page
    .getByRole('button', { name: 'Load earlier messages' })
    .filter({ visible: true })

  // Scrolled up first, as a reader is: a click in the frame it scrolls in comes before the chat
  // hears of the scroll, so it would still follow the bottom.
  await button.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))))
  await button.click()
  await posts.first().waitFor()
  const all = await posts.count()
  const top = page.getByText(`${title} post ${String(LONG_POSTS - DRAWN + 1)}`, {
    exact: true,
  })

  if (all !== LONG_POSTS)
    throw new Error(`${title} drew ${String(all)} posts after loading earlier`)
  if (!(await top.isVisible()) || !(await top.evaluate(inView)))
    throw new Error(`${title} lost its first drawn post from view after loading earlier`)
  console.log(`${title}: ${String(drawn)} drawn on opening, ${String(all)} after loading earlier`)
}

function inView(element: Element) {
  const box = element.getBoundingClientRect()

  return box.bottom > 0 && box.top < window.innerHeight
}
