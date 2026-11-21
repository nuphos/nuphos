// Replace in Bot details starts the same Bot fresh: its next reply runs in a new session that
// reads a short summary instead of the chat so far, and the chat marks where that happened.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentEvents, agentLog } from '../agent-log.ts'
import { artifacts, until } from '../processes.ts'
import { noMenuOpen, setBotDetails } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Locator, Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')
const NAME = 'Fresh Bot'
const OLD = ['fresh-1', 'fresh-2', 'fresh-3', 'fresh-4']

const details = (page: Page) => page.getByRole('complementary', { name: 'Bot details' })
const header = (page: Page) =>
  page.locator('.workspace-agent-titlebar').filter({ hasText: NAME }).first()
/** The sidebar rows that name `name`. */
const rows = (page: Page, name: string) =>
  page.locator('[data-sidebar-row]').filter({ hasText: name })

/** The Bot as Mongo holds it: what must not change, and the session its next turn runs in. */
function stored(stack: Stack, sessionId: string) {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bot = await client.db('nuphos_e2e').collection('agent_conversations')
      .findOne({ sessionId: process.argv[2] })
    console.log(JSON.stringify({
      sessionId: bot?.sessionId, title: bot?.title, avatar: bot?.avatar,
      inner: bot?.claudeCodePreview?.openabSessionId ?? null,
      compactionMessageCount: bot?.compactionMessageCount ?? null,
    }))
    await client.close()`
  const out = execFileSync('bun', ['-e', script, stack.mongoUri, sessionId], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })

  return JSON.parse(out.toString()) as {
    sessionId?: string
    title?: string
    avatar?: string
    inner: string | null
    compactionMessageCount: number | null
  }
}

async function shoot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${artifacts}/bot-start-fresh-${name}-light.png` })
}

/** Posts in the open chat as its person does, and waits for the Bot's answer there. */
async function post(page: Page, marker: string) {
  await page.locator(`[aria-placeholder="Message ${NAME}"]`).click()
  await page.keyboard.type(`Check the deploy E2E_DELIVERY:${marker}`)
  await page.keyboard.press('Enter')
  await page.getByText(`POSTED E2E_DELIVERY:${marker}`, { exact: true }).first().waitFor()
}

/** Waits out the turn that answered `marker`: no Thinking in the header, no typing in the chat. */
async function idle(page: Page, stack: Stack, marker: string) {
  await until(`the turn for ${marker} to finish`, async () =>
    agentEvents(stack).includes(`finish E2E_DELIVERY:${marker}`),
  )
  await header(page).getByText('Thinking…').first().waitFor({ state: 'hidden' })
  await page.getByRole('status', { name: `${NAME} is thinking` }).waitFor({ state: 'hidden' })
}

/** Once its last turn is over, Replace can be pressed. */
async function replaceReady(page: Page, stack: Stack, replace: Locator) {
  await replace.waitFor()
  await idle(page, stack, OLD.at(-1)!)
  await until('Replace to be enabled', () => replace.isEnabled())
}

/** The link its sidebar row's Copy link puts on the clipboard. */
async function copyLink(page: Page) {
  await page.evaluate(() => {
    const clipboard = navigator.clipboard as Clipboard & { copied?: string }

    clipboard.writeText = async (text) => {
      clipboard.copied = text
    }
  })
  let link: string | undefined

  try {
    await rows(page, NAME).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click()
    await until('the link to be copied', async () => {
      link = await page.evaluate(() => (navigator.clipboard as { copied?: string }).copied)

      return link
    })
  } finally {
    // Removes the stand-in, so the clipboard is the browser's own again for the scenarios after.
    await page.evaluate(() => {
      Reflect.deleteProperty(navigator.clipboard, 'writeText')
      Reflect.deleteProperty(navigator.clipboard, 'copied')
    })
  }
  await noMenuOpen(page)

  return link!
}

/** The face its chat header shows. */
const face = (page: Page) => header(page).locator('img').first().getAttribute('src')

/** Its chat's link and face before Replace, to compare with once it has started fresh. */
async function linkAndFace(page: Page) {
  const link = await copyLink(page)
  const shown = await face(page)

  if (!shown?.includes('07-ada')) throw new Error(`Its header shows ${String(shown)}`)

  return { link, face: shown }
}

/** The E2E Bot's chat, where the scenarios around this one start and end. */
async function openE2EBot(page: Page) {
  await rows(page, 'E2E Bot').first().click()
  await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
}

/** Opens `link` from another chat, and checks it shows this Bot by its name and `shown` face. */
async function opensSameBot(page: Page, stack: Stack, link: string, shown: string) {
  await openE2EBot(page)
  await page.evaluate(
    async ([modulePath, href]) => {
      const { openInApp } = (await import(modulePath)) as { openInApp: (href: string) => void }

      openInApp(href)
    },
    ['/src/app/workspace/openInApp.ts', link] as const,
  )
  await page.locator(`[aria-placeholder="Message ${NAME}"]`).waitFor()
  await header(page).waitFor()
  await idle(page, stack, 'fresh-new')
  const now = await face(page)

  if (now !== shown) throw new Error(`${link} opened a chat whose face is ${String(now)}`)
}

/** Leaves the app as the next scenario expects it: in the E2E Bot's chat, no menu open, and this
 *  Bot archived and gone from the Bots list, so that list no longer changes under that scenario. */
async function leave(page: Page, stack: Stack, sessionId: string) {
  const archived = await fetch(`${stack.apiUrl}/agent/conversations/${sessionId}/archive`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: stack.teamId, archived: true }),
  })

  if (!archived.ok) throw new Error(`Archiving the Bot answered ${String(archived.status)}`)
  await openE2EBot(page)
  await until(`${NAME} to leave the Bots list`, async () => (await rows(page, NAME).count()) === 0)
  await noMenuOpen(page)
}

/** The fixture turn that answered `marker`. */
function turn(stack: Stack, marker: string) {
  const found = agentLog(stack).find(
    (entry) => entry.event === 'start' && entry.marker === `E2E_DELIVERY:${marker}`,
  )

  if (!found) throw new Error(`No turn answered E2E_DELIVERY:${marker}`)

  return found
}

const scenario: Scenario = {
  name: 'Replace starts a Bot fresh: the same Bot, a new session that reads only a summary',
  run: async (page, stack) => {
    const created = await fetch(`${stack.apiUrl}/agent/bots`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: stack.teamId, title: NAME, avatar: '07-ada' }),
    })

    if (!created.ok) throw new Error(`Creating the Bot answered ${String(created.status)}`)
    const bot = (await created.json()) as { sessionId: string }

    await page.getByRole('tab', { name: /^Bots/ }).click()
    await rows(page, NAME).first().click()
    for (const marker of OLD) await post(page, marker)
    const before = stored(stack, bot.sessionId)
    const oldSession = turn(stack, OLD.at(-1)!).sessionId

    // Its owner's card: Replace beside Task and Desktop, in the same style.
    await setBotDetails(page, true)
    const card = details(page).getByRole('region', { name: NAME })
    const replace = card.getByRole('button', { name: 'Replace', exact: true })

    await replaceReady(page, stack, replace)
    await shoot(page, 'card')
    const shared = await linkAndFace(page)

    await replace.click()
    const dialog = page.getByRole('alertdialog')

    await dialog.getByText(`Start ${NAME} fresh?`).waitFor()
    await dialog
      .getByText(/keeps its name, instructions, connections, sharing and helper Bots/)
      .waitFor()
    await shoot(page, 'confirm')
    await dialog.getByRole('button', { name: 'Replace', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await setBotDetails(page, false)

    // The chat marks the point, and keeps every message above it to read.
    await page.getByText(new RegExp(`^${NAME} started fresh · `)).waitFor()
    await page.getByText(`POSTED E2E_DELIVERY:${OLD[0]!}`, { exact: true }).first().waitFor()
    await until('the next turn to have no session yet', async () => {
      const now = stored(stack, bot.sessionId)

      return now.inner === null && (now.compactionMessageCount ?? 0) > 0
    })
    await shoot(page, 'divider')

    // The next reply runs in a session opened for it, which reads the summary, not the chat.
    await post(page, 'fresh-new')
    const next = turn(stack, 'fresh-new')

    if (next.sessionId === oldSession)
      throw new Error('The turn after Replace ran in the session from before it')
    if (
      !agentLog(stack).some(
        (entry) => entry.event === 'session' && entry.sessionId === next.sessionId,
      )
    )
      throw new Error('No new session was opened for the turn after Replace')
    if (next.markers?.includes(`E2E_DELIVERY:${OLD[0]!}`))
      throw new Error(
        `The new session was given the first message: ${JSON.stringify(next.markers)}`,
      )
    if (!next.history?.readConversation)
      throw new Error('The new session was not told where the earlier messages are')
    await shoot(page, 'after')

    // The same Bot: its id, name and face.
    const after = stored(stack, bot.sessionId)

    if (
      after.sessionId !== before.sessionId ||
      after.title !== before.title ||
      after.avatar !== before.avatar
    )
      throw new Error(`Replace changed the Bot: ${JSON.stringify({ before, after })}`)
    if (!after.inner || after.inner === before.inner)
      throw new Error('The next turn did not record a session of its own')

    // A link to its chat from before still opens this Bot.
    await opensSameBot(page, stack, shared.link, shared.face)
    await leave(page, stack, bot.sessionId)
  },
}

export default scenario
