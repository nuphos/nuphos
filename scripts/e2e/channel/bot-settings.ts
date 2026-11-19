// #3298: the Bot chat's composer edits the Bot's own permission mode and model. The E2E Bot's
// setup finished in a scenario before; this one opens the Bot's chat itself.
import { artifacts } from '../processes.ts'
import { openBotTask, setBotDetails } from '../ui.ts'

import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

/** The composer in front: a Bot chat stays mounted, inert, behind the Bot's own page. */
const composer = (page: Page) =>
  page.locator(
    "xpath=//*[contains(concat(' ', @class, ' '), ' composer-surface ')][not(ancestor::*[@inert])] >> visible=true",
  )

/** The composer's permission mode and model, as its two chips read. */
async function composerSettings(page: Page) {
  const modeChip = composer(page).getByRole('button', { name: 'Authorization mode' })
  // What it shows: the other mode's label stays in the chip, unseen, to keep its width.
  const mode = await modeChip.innerText()
  const chip = composer(page).getByRole('button', { name: /^Model settings/ })
  const model = await chip.getAttribute('aria-label')

  return { full: Boolean(mode?.includes('Full')), model: model ?? '' }
}

/** Sets the composer's permission mode and model. */
async function setComposerSettings(page: Page, full: boolean, model: string) {
  await composer(page).getByRole('button', { name: 'Authorization mode' }).click()
  await page.getByRole('menuitem', { name: full ? /^Full Access/ : /^Auto Mode/ }).click()
  await composer(page)
    .getByRole('button', { name: /^Model settings/ })
    .click()
  await page.getByRole('menuitemcheckbox', { name: new RegExp(model) }).click()
  const name = new RegExp(`^Model settings: ${model}`)

  await composer(page).getByRole('button', { name }).waitFor()
}

const scenario: Scenario = {
  name: "the Bot composer and the Bot's own page change the same permission mode and model",
  run: async (page) => {
    const chat = () => composer(page)

    // The scenario before may have left a Task open.
    await page.getByRole('tab', { name: /^Bots/ }).click()
    await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
    await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    })
    await page.getByRole('textbox', { name: 'Message' }).waitFor()
    await page.waitForTimeout(1_000)
    await chat().screenshot({ path: `${artifacts}/bot-controls-composer-light.png` })
    // From the chat: the Bot's page shows what was picked there.
    await setComposerSettings(page, true, 'fixture-large')
    // Its setup has finished, so the Bot's page opens from the chat.
    await openBotTask(page)
    await page.getByText('Back to conversation').waitFor()
    await composer(page)
      .getByRole('button', { name: /^Model settings: fixture-large/ })
      .waitFor()
    const onPage = await composerSettings(page)

    if (!onPage.full) throw new Error(`The Bot's page shows ${JSON.stringify(onPage)}`)
    // From the Bot's page: the chat shows what was picked there.
    await setComposerSettings(page, false, 'fixture-small')
    await page.getByText('Back to conversation').click()
    await page.getByText('Back to conversation').waitFor({ state: 'hidden' })
    await setBotDetails(page, false)
    await composer(page)
      .getByRole('button', { name: /^Model settings: fixture-small/ })
      .waitFor()
    const inChat = await composerSettings(page)

    await chat().screenshot({ path: `${artifacts}/bot-controls-composer-after-light.png` })
    if (inChat.full) throw new Error(`The Bot chat shows ${JSON.stringify(inChat)}`)
    // The Bot stays in Auto Mode: the Task scenario that runs last starts in Full Access,
    // so a Bot's mode leaking into the default for new chats fails there.
  },
}

export default scenario
