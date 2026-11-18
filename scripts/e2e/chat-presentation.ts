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

export async function checkOutgoingChip(page: Page, agentMention?: string): Promise<void> {
  if (agentMention)
    await page.getByRole('button', { name: agentMention, exact: true }).last().waitFor()
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

/** The workspace panel toggle floats over a chat header, or over the dock's tab strip once the dock is open; either must end left of it (#3312). */
export async function checkDockToggleClear(
  page: Page,
  where: string,
  selector = '.workspace-agent-titlebar',
): Promise<void> {
  const room = await page.evaluate((under) => {
    // Panes left open stay mounted, hidden: only the one on screen counts.
    const shown = (query: string) =>
      [...document.querySelectorAll(query)].find((node) => node.getBoundingClientRect().width > 0)
    const toggle = shown('.workspace-dock-toggle')?.getBoundingClientRect()
    const row = shown(under)

    if (!toggle || !row) return null

    const contentRight =
      row.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(row).paddingRight)

    return { contentRight, toggleLeft: toggle.left }
  }, selector)

  if (!room) throw new Error(`The ${where} or the workspace panel toggle is not on screen`)
  console.log(
    `${where}: content ends at ${String(Math.round(room.contentRight))} px, toggle starts at ${String(Math.round(room.toggleLeft))} px`,
  )
  await page.screenshot({ path: `${artifacts}/dock-toggle-${where.replaceAll(' ', '-')}.png` })
  if (room.contentRight > room.toggleLeft)
    throw new Error(
      `The ${where} runs ${String(Math.round(room.contentRight - room.toggleLeft))} px under the workspace panel toggle`,
    )
}
