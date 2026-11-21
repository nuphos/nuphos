import { artifacts } from './processes.ts'

import type { Page } from 'playwright-core'

/** Content must finish outside the sidebar fade and start clear of the chat header. */
export async function checkChatSpacing(page: Page): Promise<void> {
  const bottom = await page
    .locator('.sidebar-page-list')
    .first()
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingBottom))
  const top = await page
    .locator('.selectable.overflow-y-auto')
    .last()
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingTop))

  if (bottom <= 26) throw new Error(`Sidebar content ends within the 26px fade: ${bottom}px`)
  await page.screenshot({ path: `${artifacts}/bot-first-reply.png` })

  if (top < 32) throw new Error(`Bot chat content starts too close to the header: ${top}px`)
}

let capturedTail = false

/** Save a real overflowed list at its scroll limit, then restore the reader's position. */
export async function captureScenario(page: Page, index: number): Promise<void> {
  if (!capturedTail) {
    const lists = page.locator('.sidebar-page-list')

    for (const list of await lists.all()) {
      const state = await list.evaluate((node) => {
        const box = node.getBoundingClientRect()

        return {
          visible: box.left >= 0 && box.right < 500 && box.height > 0,
          overflow: node.scrollHeight > node.clientHeight + 50,
          top: node.scrollTop,
        }
      })

      if (!state.visible || !state.overflow) continue
      await list.evaluate((node) => {
        node.scrollTop = node.scrollHeight
      })
      const geometry = await list.evaluate((node) => {
        const rows = [...node.querySelectorAll('[data-sidebar-row]')].filter(
          (row) => row.getBoundingClientRect().height > 0,
        )
        const row = rows.at(-1)?.getBoundingClientRect()
        const box = node.getBoundingClientRect()

        return {
          gap: row ? box.bottom - row.bottom : -1,
          atEnd: Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2,
        }
      })

      if (!geometry.atEnd || geometry.gap < 26)
        throw new Error(
          `Last sidebar row is obscured at the scroll limit: ${JSON.stringify(geometry)}`,
        )
      await page.screenshot({ path: `${artifacts}/sidebar-long-list-tail.png` })
      console.log(`PASS sidebar last row above fade: ${JSON.stringify(geometry)}`)
      capturedTail = true
      await list.evaluate((node, top) => {
        node.scrollTop = top
      }, state.top)
      break
    }
  }
  await page.screenshot({ path: `${artifacts}/${String(index)}.png` })
}
