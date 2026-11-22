// What a chat opened before keeps when it is opened again: the same transcript on screen, not a
// rebuilt one, scrolled to its newest post, with the draft left in its composer.
import { until } from './processes.ts'
import { newTask } from './ui.ts'

import type { Page } from 'playwright-core'

type Seen = { kept: boolean; atBottom: boolean } | null

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })

// The post that reads `text` in the chat on screen, marked when `mark` so a rebuilt view shows
// up as an unmarked one, and whether its transcript is scrolled to the end.
function seen(page: Page, text: string, mark: boolean): Promise<Seen> {
  return page.evaluate(
    ({ text, mark }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let post: (HTMLElement & { e2eKept?: true }) | null = null

      for (let node = walker.nextNode(); node && !post; node = walker.nextNode()) {
        const element = node.parentElement

        if (node.textContent?.trim() !== text || !element || element.closest('aside')) continue
        if (element.checkVisibility()) post = element
      }
      if (!post) return null
      const kept = post.e2eKept === true

      if (mark) post.e2eKept = true
      let box = post.parentElement

      while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement

      return { kept, atBottom: !box || box.scrollHeight - box.scrollTop - box.clientHeight <= 2 }
    },
    { text, mark },
  )
}

const draftIn = (title: string) => `Draft in ${title}`

/** Chats opened again that were not as they were left, with what differed. */
export const notKept: string[] = []

/** Marks chat `title`, on screen, by its post `text`, and leaves a draft in its composer. */
export async function leave(page: Page, title: string, text: string) {
  if (!(await seen(page, text, true))) throw new Error(`"${text}" is not on screen to mark`)
  await composer(page).fill(draftIn(title))
}

/** Checks chat `title`, opened again, is the one `leave` left; notes it in `notKept` if not. */
export async function kept(page: Page, name: string, title: string, text: string) {
  // The dot its sidebar row shows while it holds a post not yet seen.
  const unread = async () =>
    (await page
      .locator('[data-sidebar-row]:visible')
      .filter({ hasText: title })
      .getByLabel('Unread reply')
      .count()) > 0
  const draft = async () => (await composer(page).innerText()).trim()

  try {
    await until(
      `${name}: kept, at the bottom, with its draft, read`,
      async () => {
        const now = await seen(page, text, false)

        return now?.kept && now.atBottom && (await draft()) === draftIn(title) && !(await unread())
      },
      10_000,
    )
  } catch {
    const now = await seen(page, text, false)

    notKept.push(
      `${name}: kept ${String(now?.kept ?? false)}, at bottom ${String(now?.atBottom ?? false)}, draft "${await draft()}", unread ${String(await unread())}`,
    )
  }
}

/** A chat opened from the sidebar takes the keyboard. */
export async function focused(page: Page, name: string) {
  await until(
    `${name}: its composer focused`,
    () => composer(page).evaluate((element) => element.contains(document.activeElement)),
    5_000,
  )
}

const HOME_DRAFT = 'Draft on the New Task page'

/** Leaves a draft on the New Task page on screen. */
export async function leaveHome(page: Page) {
  await composer(page).fill(HOME_DRAFT)
}

/** Back to the New Task page, which kept the draft `leaveHome` left. */
export async function backHome(page: Page) {
  await newTask(page)
  await until(
    'the New Task page to keep its draft',
    async () => (await composer(page).innerText()).trim() === HOME_DRAFT,
    5_000,
  )
}
