// #3298: the Bot chat edits the Bot's own permission mode and model, in Bot details since #3790
// and #4766.
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

/** A Bot chat's control is in its details, the Bot's page's in its composer. */
const control = (page: Page, chat: boolean, name: RegExp) =>
  (chat ? page.getByRole('complementary', { name: 'Bot details' }) : composer(page)).getByRole(
    'button',
    { name },
  )

/** The permission mode and the model, as their controls read. */
async function settings(page: Page, chat: boolean) {
  // What it shows: the other mode's label stays in the chip, unseen, to keep its width.
  const mode = await control(page, chat, /Authorization mode/).innerText()
  const model = await control(page, chat, /^Model settings/).getAttribute('aria-label')

  return { full: Boolean(mode?.includes('Full')), model: model ?? '' }
}

/** Sets the permission mode and the model. */
async function setSettings(page: Page, chat: boolean, full: boolean, model: string) {
  await control(page, chat, /Authorization mode/).click()
  await page.getByRole('menuitem', { name: full ? /^Full Access/ : /^Auto Mode/ }).click()
  await control(page, chat, /^Model settings/).click()
  await page.getByRole('menuitemcheckbox', { name: new RegExp(model) }).click()
  await control(page, chat, new RegExp(`^Model settings: ${model}`)).waitFor()
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
    await setSettings(page, true, true, 'fixture-large')
    // Its setup has finished, so the Bot's page opens from the chat.
    await openBotTask(page)
    await page.getByText('Back to conversation').waitFor()
    await control(page, false, /^Model settings: fixture-large/).waitFor()
    const onPage = await settings(page, false)

    if (!onPage.full) throw new Error(`The Bot's page shows ${JSON.stringify(onPage)}`)
    // From the Bot's page: the chat shows what was picked there.
    await setSettings(page, false, false, 'fixture-small')
    await page.getByText('Back to conversation').click()
    await page.getByText('Back to conversation').waitFor({ state: 'hidden' })
    await setBotDetails(page, true)
    await control(page, true, /^Model settings: fixture-small/).waitFor()
    const inChat = await settings(page, true)

    await setBotDetails(page, false)

    await chat().screenshot({ path: `${artifacts}/bot-controls-composer-after-light.png` })
    if (inChat.full) throw new Error(`The Bot chat shows ${JSON.stringify(inChat)}`)
    // The Bot stays in Auto Mode: the Task scenario that runs last starts in Full Access,
    // so a Bot's mode leaking into the default for new chats fails there.
  },
}

export default scenario
