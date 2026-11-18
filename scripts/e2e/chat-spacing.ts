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
