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
    // Panes left open stay mounted, hidden: only the one on screen counts.
    const shown = (selector: string) =>
      [...document.querySelectorAll(selector)].find(
        (node) => node.getBoundingClientRect().width > 0,
      )
    const toggle = shown('.workspace-dock-toggle')?.getBoundingClientRect()
    const header = shown('.workspace-agent-titlebar')

    if (!toggle || !header) return null

    const contentRight =
      header.getBoundingClientRect().right -
      Number.parseFloat(getComputedStyle(header).paddingRight)

    return { contentRight, toggleLeft: toggle.left }
  })

  if (!room) throw new Error(`The ${where} has no chat header or workspace panel toggle`)
  console.log(
    `${where}: header content ends at ${String(Math.round(room.contentRight))} px, toggle starts at ${String(Math.round(room.toggleLeft))} px`,
  )
  await page.screenshot({ path: `${artifacts}/dock-toggle-${where.replaceAll(' ', '-')}.png` })
  if (room.contentRight > room.toggleLeft)
    throw new Error(
      `The ${where}'s header runs ${String(Math.round(room.contentRight - room.toggleLeft))} px under the workspace panel toggle`,
    )
}

/** Scratch evidence: the dock's tab strip while the dock is open. */
export async function captureTabStrip(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open workspace panel' }).click()
  await page.waitForTimeout(1_500)
  const strip = await page.evaluate(() => {
    const node = [...document.querySelectorAll('.sheet-titlebar-row.bg-main.titlebar-drag')].find(
      (candidate) => candidate.getBoundingClientRect().width > 0,
    )
    const toggle = document.querySelector('.workspace-dock-toggle')?.getBoundingClientRect()

    if (!node || !toggle) return null
    const box = node.getBoundingClientRect()

    return {
      classes: node.className,
      paddingRight: getComputedStyle(node).paddingRight,
      left: box.left,
      right: box.right,
      height: box.height,
      toggleLeft: toggle.left,
      captionReserve: getComputedStyle(document.documentElement).getPropertyValue(
        '--caption-reserve',
      ),
    }
  })

  console.log(`TABSTRIP ${JSON.stringify(strip)}`)
  await page.screenshot({ path: `${artifacts}/tab-strip-dock-open.png` })
  await page.getByRole('button', { name: 'Close workspace panel' }).click()
  await page.waitForTimeout(500)
}
