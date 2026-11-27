// A Bot's owner rewrites its instructions in Edit Bot's Advanced page, saved with the rest.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { artifacts, until } from '../processes.ts'
import { setBotDetails } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')
const NAME = 'Instructions Bot'
const LONG = Array.from(
  { length: 30 },
  (_, i) => `${String(i + 1)}. Check the release notes.`,
).join('\n')

const details = (page: Page) => page.getByRole('complementary', { name: 'Bot details' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Edit Bot' })
const field = (page: Page) => dialog(page).getByRole('textbox', { name: /^Instructions/ })

/** Runs a script against the E2E database and returns what it printed. */
function mongo(stack: Stack, script: string, ...args: string[]): string {
  return execFileSync('bun', ['-e', script, stack.mongoUri, ...args], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
    .toString()
    .trim()
}

const stored = (stack: Stack, sessionId: string) =>
  mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bot = await client.db('nuphos_e2e').collection('agent_conversations')
      .findOne({ sessionId: process.argv[2] })
    console.log(JSON.stringify(bot?.instructions ?? null))
    await client.close()`,
    sessionId,
  )

async function shoot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${artifacts}/bot-instructions-${name}-light.png` })
}

async function openChat(page: Page, name: string) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: name }).first().click()
  await page.locator(`[aria-placeholder="Message ${name}"]`).waitFor()
}

async function openAdvanced(page: Page) {
  await details(page).getByRole('button', { name: 'Edit Bot' }).click()
  await dialog(page).getByRole('tab', { name: 'Advanced' }).click()
  await field(page).waitFor()
}

async function api(stack: Stack, path: string, body: object, method = 'POST', token = stack.token) {
  const response = await fetch(`${stack.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: stack.teamId, ...body }),
  })

  if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`)

  return (await response.json()) as { sessionId: string; id: string }
}

const scenario: Scenario = {
  name: "a Bot's owner rewrites its instructions in Edit Bot, saved with the rest",
  // The over-long save is refused on purpose, to show where the reason goes.
  expected:
    /"method":"PATCH","path":"\/agent\/conversations\/[0-9a-f-]+\/instructions","status":400/,
  run: async (page, stack) => {
    const bot = await api(stack, '/agent/bots', { title: NAME, avatar: '07-ada' })

    await openChat(page, NAME)
    await setBotDetails(page, true)
    // Bot details no longer carries the instructions: they live in Edit Bot.
    if ((await details(page).getByText('Bot instructions').count()) > 0)
      throw new Error('Bot details still shows the instructions')
    await openAdvanced(page)
    await dialog(page).getByText('No triggers yet').waitFor()
    await shoot(page, 'empty')

    // Saving: the dialog closes and the instructions are stored as typed.
    await field(page).fill(LONG)
    await shoot(page, 'editing')
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await dialog(page).waitFor({ state: 'detached' })
    await until(
      'the instructions to be stored',
      async () => stored(stack, bot.sessionId) === JSON.stringify(LONG),
    )
    await page.reload()
    await openChat(page, NAME)
    await openAdvanced(page)
    if ((await field(page).inputValue()) !== LONG) throw new Error('Edit Bot lost the Markdown')

    // Refused: the dialog stays open with the text, and the reason shows in a toast.
    await field(page).fill('x'.repeat(8001))
    await dialog(page).getByRole('button', { name: 'Save' }).click()
    await page
      .getByRole('region', { name: 'Notifications' })
      .getByText('Instructions must be at most 8000 characters')
      .waitFor()
    if ((await field(page).inputValue()).length !== 8001)
      throw new Error('A refused save lost the text')
    await shoot(page, 'save-failed')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await dialog(page).waitFor({ state: 'detached' })
    if (stored(stack, bot.sessionId) !== JSON.stringify(LONG))
      throw new Error('A refused save changed the instructions')

    // Out of the lists the scenarios after this one read.
    await setBotDetails(page, false)
    await api(stack, `/agent/conversations/${bot.sessionId}/archive`, { archived: true }, 'PATCH')
    await openChat(page, 'E2E Bot')
  },
}

export default scenario
