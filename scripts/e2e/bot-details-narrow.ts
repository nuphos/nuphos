// #4077: Bot details narrow, where they close and open by hand as a popover under the Bot's name.
import { artifacts } from './processes.ts'
import { botDetailsToggle } from './ui.ts'

import type { Page } from 'playwright-core'

const NARROW = { width: 820, height: 760, deviceScaleFactor: 0, mobile: false }

export const details = (page: Page) => page.getByRole('complementary', { name: 'Bot details' })
// Exact: the Bot's card is a region too, named after the Bot.
export const access = (page: Page) =>
  details(page).getByRole('region', { name: 'Access', exact: true })
/** A light capture of the window once the panel or menu has landed. */
export async function shoot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${artifacts}/bot-access-${name}-light.png` })
}

const floats = (page: Page) =>
  details(page).evaluate((panel) => getComputedStyle(panel).position === 'fixed')

/** In the popover: its end scrolled to, a picker opened in it, and what closes which. */
async function peekNarrow(page: Page) {
  await botDetailsToggle(page).click()
  await access(page)
    .getByRole('button', { name: /^Credentials/ })
    .waitFor()
  if (!(await floats(page))) throw new Error('Opened narrow, the details sit beside the chat')
  await details(page).evaluate((panel) => panel.scrollTo({ top: panel.scrollHeight }))
  await shoot(page, 'owner-narrow')
  // A picker it opens sits outside it: leaving for it, or past it, keeps the popover.
  await access(page)
    .getByRole('button', { name: /^Credentials/ })
    .click()
  await page.getByRole('menu').waitFor()
  await shoot(page, 'narrow-picker')
  await page.mouse.move(NARROW.width - 24, NARROW.height / 2)
  await page.waitForTimeout(600)
  await details(page).waitFor()
  // Esc closes the picker first, then the popover.
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'detached' })
  await details(page).waitFor()
  await page.keyboard.press('Escape')
  await details(page).waitFor({ state: 'detached' })
  // Crossing from the name to the popover keeps it; leaving both closes it.
  await botDetailsToggle(page).click()
  await details(page).hover()
  await page.waitForTimeout(600)
  await details(page).waitFor()
  await page.mouse.move(NARROW.width - 24, NARROW.height / 2)
  await details(page).waitFor({ state: 'detached' })
}

/** #4077: narrow, the details close; opened by hand, a popover under the Bot's name. */
export async function narrowDetails(page: Page) {
  if (await floats(page)) throw new Error('Wide, the details float')
  await shoot(page, 'wide-docked')
  const cdp = await page.context().newCDPSession(page)

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', NARROW)
    await page.locator('[data-summary-toggle][aria-expanded="false"]:visible').waitFor()
    await details(page).waitFor({ state: 'detached' })
    await shoot(page, 'narrow-closed')
    await peekNarrow(page)
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await cdp.detach()
  }
  // Wide again, they are back beside the chat, as Choose left them.
  await access(page)
    .getByRole('button', { name: /^Credentials/ })
    .waitFor()
  if (await floats(page)) throw new Error('Wide again, the details still float')
  await shoot(page, 'owner-wide-again')
}
