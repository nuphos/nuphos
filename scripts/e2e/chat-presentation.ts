// Inspect the real renderer's computed styles, including the outgoing dark bubble.
import { artifacts } from './processes.ts'

import type { Page } from 'playwright-core'

export async function checkDecisionOutline(page: Page): Promise<void> {
  const card = page.locator('[data-decision-card]').last()
  const borders = await card.evaluate((node) => {
    const style = getComputedStyle(node)

    return [
      style.borderLeftWidth,
      style.borderRightWidth,
      style.borderTopWidth,
      style.borderBottomWidth,
    ]
  })

  if (borders.some((width) => Number.parseFloat(width) < 1))
    throw new Error(`Decision card has an incomplete outline: ${borders.join(', ')}`)
}

export async function checkOutgoingChip(page: Page): Promise<void> {
  const chip = page.locator('.user-message-bubble .chat-resource-chip').last()

  await chip.waitFor()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(value)
    }, theme)
    const decoration = await chip.evaluate((node) => getComputedStyle(node).textDecorationLine)

    if (decoration !== 'none')
      throw new Error(`Resource chip is decorated in ${theme}: ${decoration}`)
    await page.screenshot({ path: `${artifacts}/outgoing-chip-${theme}.png` })
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
}

/** The workspace panel toggle floats over the chat header's right end; the header's content must end left of it (#3312). */
export async function checkDockToggleClear(page: Page, where: string): Promise<void> {
  const room = await page.evaluate(() => {
    const toggle = document.querySelector('.workspace-dock-toggle')?.getBoundingClientRect()
    const header = document.querySelector('.workspace-agent-titlebar')

    if (!toggle || !header) return null

    const contentRight =
      header.getBoundingClientRect().right -
      Number.parseFloat(getComputedStyle(header).paddingRight)

    return { contentRight, toggleLeft: toggle.left }
  })

  if (!room) throw new Error(`The ${where} has no chat header or workspace panel toggle`)
  await page.screenshot({ path: `${artifacts}/dock-toggle-${where.replaceAll(' ', '-')}.png` })
  if (room.contentRight > room.toggleLeft)
    throw new Error(
      `The ${where}'s header runs ${String(Math.round(room.contentRight - room.toggleLeft))} px under the workspace panel toggle`,
    )
}
