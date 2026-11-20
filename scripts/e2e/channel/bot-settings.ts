// #3298: the Bot chat edits the Bot's own permission mode, in Bot details since #3790, and model.
// The E2E Bot's setup finished in a scenario before; this one opens the Bot's chat itself.
import { artifacts } from '../processes.ts'
import { openBotTask, setBotDetails } from '../ui.ts'

import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

/** The composer in front: a Bot chat stays mounted, inert, behind the Bot's own page. */
const composer = (page: Page) =>
  page.locator(
    "xpath=//*[contains(concat(' ', @class, ' '), ' composer-surface ')][not(ancestor::*[@inert])] >> visible=true",
  )

/** The mode control: a Bot chat's in its details' Access section, the Bot's page's in its composer. */
const modeControl = (page: Page, chat: boolean) =>
  (chat ? page.getByRole('complementary', { name: 'Bot details' }) : composer(page)).getByRole(
    'button',
    { name: 'Authorization mode' },
  )

/** The permission mode and the composer's model, as their controls read. */
async function composerSettings(page: Page, chat: boolean) {
  const modeChip = modeControl(page, chat)
  // What it shows: the other mode's label stays in the chip, unseen, to keep its width.
  const mode = await modeChip.innerText()
  const chip = composer(page).getByRole('button', { name: /^Model settings/ })
  const model = await chip.getAttribute('aria-label')

  return { full: Boolean(mode?.includes('Full')), model: model ?? '' }
}

/** Sets the permission mode and the composer's model. */
async function setComposerSettings(page: Page, chat: boolean, full: boolean, model: string) {
  await modeControl(page, chat).click()
  await page.getByRole('menuitem', { name: full ? /^Full Access/ : /^Auto Mode/ }).click()
  await composer(page)
    .getByRole('button', { name: /^Model settings/ })
    .click()
  await page.getByRole('menuitemcheckbox', { name: new RegExp(model) }).click()
  const name = new RegExp(`^Model settings: ${model}`)

  await composer(page).getByRole('button', { name }).waitFor()
}

const scenario: Scenario = {
  name: "the Bot chat and the Bot's own page change the same permission mode and model",
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
    await setBotDetails(page, true)
    await setComposerSettings(page, true, true, 'fixture-large')
    // Its setup has finished, so the Bot's page opens from the chat.
    await openBotTask(page)
    await page.getByText('Back to conversation').waitFor()
    await composer(page)
      .getByRole('button', { name: /^Model settings: fixture-large/ })
      .waitFor()
    const onPage = await composerSettings(page, false)

    if (!onPage.full) throw new Error(`The Bot's page shows ${JSON.stringify(onPage)}`)
    // From the Bot's page: the chat shows what was picked there.
    await setComposerSettings(page, false, false, 'fixture-small')
    await page.getByText('Back to conversation').click()
    await page.getByText('Back to conversation').waitFor({ state: 'hidden' })
    await composer(page)
      .getByRole('button', { name: /^Model settings: fixture-small/ })
      .waitFor()
    await setBotDetails(page, true)
    const inChat = await composerSettings(page, true)

    await setBotDetails(page, false)

    await chat().screenshot({ path: `${artifacts}/bot-controls-composer-after-light.png` })
    if (inChat.full) throw new Error(`The Bot chat shows ${JSON.stringify(inChat)}`)
    // The Bot stays in Auto Mode: the Task scenario that runs last starts in Full Access,
    // so a Bot's mode leaking into the default for new chats fails there.
  },
}

export default scenario
