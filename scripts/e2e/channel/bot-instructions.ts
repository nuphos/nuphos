// A Bot's owner rewrites its instructions in Bot details, in place; anyone else only reads them.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { joinTeam } from '../dashboard-scenarios.ts'
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
const section = (page: Page) =>
  details(page).getByRole('region', { name: 'Bot instructions', exact: true })
const pencil = (page: Page) => section(page).getByRole('button', { name: 'Edit instructions' })

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

/** Gives the Bot to a member, letting the team read it. No route does this, so Mongo does. */
const handTo = (stack: Stack, sessionId: string, userId: string) =>
  mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    await client.db('nuphos_e2e').collection('agent_conversations').updateOne(
      { sessionId: process.argv[2] },
      { $set: { userId: process.argv[3], generalAccess: 'team' } },
    )
    await client.close()`,
    sessionId,
    userId,
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
  name: "a Bot's owner rewrites its instructions in Bot details; anyone else only reads them",
  // The over-long save is refused on purpose, to show where the reason goes.
  expected:
    /"method":"PATCH","path":"\/agent\/conversations\/[0-9a-f-]+\/instructions","status":400/,
  run: async (page, stack) => {
    const bot = await api(stack, '/agent/bots', { title: NAME, avatar: '07-ada' })

    await openChat(page, NAME)
    await setBotDetails(page, true)
    await section(page).getByText('None yet').waitFor()
    await pencil(page).waitFor()
    await shoot(page, 'none-yet')

    // Editing: the text becomes a field that grows to 320px, then scrolls.
    await pencil(page).click()
    const field = section(page).getByRole('textbox', { name: 'Bot instructions' })

    await field.fill(LONG)
    if ((await pencil(page).count()) > 0) throw new Error('The pencil shows while editing')
    await field.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await shoot(page, 'editing')
    await field.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await field.waitFor({ state: 'detached' })
    await section(page).getByText('30. Check the release notes.').waitFor()
    await until(
      'the instructions to be stored',
      async () => stored(stack, bot.sessionId) === JSON.stringify(LONG),
    )
    await page.reload()
    await section(page).getByText('1. Check the release notes.').waitFor()
    await shoot(page, 'owner')

    // Refused: the field stays with its text and the reason under it.
    await pencil(page).click()
    await field.fill('x'.repeat(8001))
    await section(page).getByRole('button', { name: 'Save' }).click()
    await section(page).getByText('Instructions must be at most 8000 characters').waitFor()
    if ((await field.inputValue()).length !== 8001) throw new Error('A refused save lost the text')
    await shoot(page, 'save-failed')
    await field.press('Escape')
    await field.waitFor({ state: 'detached' })
    if (stored(stack, bot.sessionId) !== JSON.stringify(LONG))
      throw new Error('A refused save changed the instructions')

    // Someone else's Bot: the same text, no pencil.
    const mate = await joinTeam(stack, 'instructions-mate')
    const me = (await (
      await fetch(`${stack.apiUrl}/auth/me`, {
        headers: { authorization: `Bearer ${stack.token}` },
      })
    ).json()) as { id: string }

    handTo(stack, bot.sessionId, mate.id)
    await page.reload()
    await openChat(page, NAME)
    await section(page).getByText('1. Check the release notes.').waitFor()
    if ((await pencil(page).count()) > 0)
      throw new Error("A teammate's Bot offers Edit instructions")
    await shoot(page, 'teammate')

    // Back to its owner, then out of the lists the scenarios after this one read.
    handTo(stack, bot.sessionId, me.id)
    await setBotDetails(page, false)
    await api(stack, `/agent/conversations/${bot.sessionId}/archive`, { archived: true }, 'PATCH')
    await openChat(page, 'E2E Bot')
  },
}

export default scenario
