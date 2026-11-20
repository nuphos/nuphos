// What a Bot may use, set in its details. Runs in the Bot chat the scenarios before opened.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { openBotTask, setBotDetails } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const CHOOSE = "This Bot can't use any computers or credentials yet. Choose what it may use."
const NARROW = { width: 820, height: 760, deviceScaleFactor: 0, mobile: false }
const SHARED = 'Shared access Bot'

/** Runs a script against the E2E database; it prints one JSON line. */
function mongo(stack: Stack, script: string, ...args: string[]): unknown {
  const out = execFileSync('bun', ['-e', script, stack.mongoUri, ...args], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  }).toString()

  return out.trim() ? JSON.parse(out) : null
}

/** The E2E Bot's stored credentialAccess. */
function botAccess(stack: Stack) {
  return mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    const bot = await bots.findOne({ title: 'E2E Bot', avatar: { $exists: true } })
    console.log(JSON.stringify({ sessionId: bot.sessionId, access: bot.credentialAccess ?? null }))
    await client.close()`,
  ) as { sessionId: string; access: unknown }
}

/** Hands a Bot to a member, letting the team read it. No route does this, so Mongo does. */
function shareAway(stack: Stack, botId: string, userId: string) {
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
    botId,
    userId,
  )
}

/** Links an issue to a Bot's session, or unlinks it. No route links one without a provider. */
function setLinkedIssue(stack: Stack, sessionId: string, linked: boolean) {
  mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const issue = { id: 'e2e-issue', provider: 'linear', title: 'E2E linked issue',
      url: 'https://linear.app/e2e/issue/E2E-1', state: 'open', linkedAt: new Date().toISOString() }
    await client.db('nuphos_e2e').collection('agent_conversations').updateOne(
      { sessionId: process.argv[2] },
      process.argv[3] === '1' ? { $set: { linkedResources: [issue] } } : { $unset: { linkedResources: '' } },
    )
    await client.close()`,
    sessionId,
    linked ? '1' : '0',
  )
}

const details = (page: Page) => page.getByRole('complementary', { name: 'Bot details' })
// Exact: the Bot's card is a region too, named after the Bot.
const access = (page: Page) => details(page).getByRole('region', { name: 'Access', exact: true })
/** The composer in front: a Bot chat stays mounted, inert, behind the Bot's own page. */
const composer = (page: Page) =>
  page.locator(
    "xpath=//*[contains(concat(' ', @class, ' '), ' composer-surface ')][not(ancestor::*[@inert])] >> visible=true",
  )

/** A light capture of the window once the panel or menu has landed. */
async function shoot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${artifacts}/bot-access-${name}-light.png` })
}

/** Opens a row's picker or menu, captures it, and closes it again. */
async function shootMenu(page: Page, row: RegExp, name: string) {
  await access(page).getByRole('button', { name: row }).click()
  await page.getByRole('menu').waitFor()
  await shoot(page, name)
  await page.keyboard.press('Escape')
  await page.getByRole('menu').waitFor({ state: 'detached' })
}

/** How many of the access controls a composer still offers. */
async function composerAccess(page: Page) {
  return composer(page)
    .getByRole('button', { name: /^(Credentials|Computers|Authorization mode)$/ })
    .count()
}

async function openChat(page: Page, name: string) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: name }).first().click()
  await page.locator(`[aria-placeholder="Message ${name}"]`).waitFor()
}

export const botAccessScenarios: Scenario[] = [
  {
    // #3259: a Bot made with "+" stored no selection, so its picker showed every computer
    // selected while the Bot could use none of them. It now shows none, and asks.
    // #3790: what it may use is chosen in Bot details, not in its chat's composer.
    name: 'a Bot made with "+" can use nothing until its owner chooses in Bot details',
    run: async (page, stack) => {
      const made = botAccess(stack)

      if (made.access) throw new Error('"+" stored computers or credentials nobody chose')
      await page.getByText(CHOOSE).waitFor()
      await shoot(page, 'choose-banner')
      if ((await composerAccess(page)) > 0)
        throw new Error("The Bot chat's composer still offers credentials, computers or a mode")
      // Choose opens Bot details at the Access section: credentials, computers and mode.
      await page.getByRole('button', { name: 'Choose', exact: true }).click()
      for (const row of [/^Credentials/, /^Computers/, /^(Full Access|Auto Mode)/])
        await access(page).getByText(row).first().waitFor()
      await shoot(page, 'owner')
      await shootMenu(page, /^Computers/, 'menu-computers')
      await shootMenu(page, /^Authorization mode/, 'menu-mode')

      // Any choice saved, even of nothing, is the Bot's answer: the prompt goes.
      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${made.sessionId}/credentials`,
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ teamId: stack.teamId, credentialAccess: { deviceIds: [] } }),
        },
      )

      if (!response.ok) throw new Error(`Saving a choice answered ${String(response.status)}`)
      await page.reload()
      await access(page)
        .getByRole('button', { name: /^Computers/ })
        .waitFor()
      await until(
        'the prompt to go once a choice is saved',
        async () => (await page.getByText(CHOOSE).count()) === 0,
      )
      // The picker shows what the Bot can use: the team-wide kinds, and nothing it was not given.
      await shootMenu(page, /^Credentials/, 'picker')

      // Narrow, the details float over the chat with the same rows.
      const cdp = await page.context().newCDPSession(page)

      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', NARROW)
        await access(page)
          .getByRole('button', { name: /^Credentials/ })
          .waitFor()
        await shoot(page, 'owner-narrow')
      } finally {
        await cdp.send('Emulation.clearDeviceMetricsOverride')
        await cdp.detach()
      }

      // A Task's sidebar lists its pull requests and issues under Changes; Bot details don't.
      setLinkedIssue(stack, made.sessionId, true)
      await page.reload()
      await access(page).waitFor()
      if ((await details(page).getByRole('region', { name: 'Changes', exact: true }).count()) > 0)
        throw new Error('Bot details show Changes')
      await shoot(page, 'no-changes')
      setLinkedIssue(stack, made.sessionId, false)

      // The Bot's own page is a Task: its composer keeps every control.
      await openBotTask(page)
      await page.getByText('Back to conversation').waitFor()
      await composer(page).getByRole('button', { name: 'Authorization mode' }).waitFor()
      if ((await composerAccess(page)) !== 3)
        throw new Error(`The Bot's page composer offers ${String(await composerAccess(page))} of 3`)
      await shoot(page, 'task-composer')
      await page.getByText('Back to conversation').click()
      await page.getByText('Back to conversation').waitFor({ state: 'hidden' })
      await setBotDetails(page, false)
    },
  },
  {
    // #3790: a teammate's Bot the team may read shows what it uses, with nothing to change.
    name: "a teammate's Bot shows its access in Bot details, read-only",
    run: async (page, stack) => {
      const mate = await joinTeam(stack, 'access-mate')
      const response = await fetch(`${stack.apiUrl}/agent/bots`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          teamId: stack.teamId,
          title: SHARED,
          avatar: '07-ada',
          agentRuntime: 'claude-code',
        }),
      })

      if (!response.ok) throw new Error(`Making a Bot answered ${String(response.status)}`)
      const bot = (await response.json()) as { sessionId: string }

      // Its chat is made while the Bot is still the viewer's; then it moves to the teammate.
      await openChat(page, SHARED)
      shareAway(stack, bot.sessionId, mate.id)
      await page.reload()
      await openChat(page, SHARED)
      await setBotDetails(page, true)
      // Its mode is shown too: whether it runs in Full Access matters to everyone it works for.
      for (const row of [/^Credentials/, /^Computers/, /^(Full Access|Auto Mode)$/])
        await access(page).getByText(row).first().waitFor()
      const offered = await access(page).getByRole('button').count()

      if (offered > 0) throw new Error(`A teammate's Bot offers ${String(offered)} access controls`)
      if ((await composerAccess(page)) > 0)
        throw new Error("A teammate's Bot chat composer offers access controls")
      await shoot(page, 'teammate')
      await setBotDetails(page, false)
      // Later scenarios list Bots by name: the Bot goes back to the viewer, who archives it
      // and its chat.
      const me = (await (
        await fetch(`${stack.apiUrl}/auth/me`, {
          headers: { authorization: `Bearer ${stack.token}` },
        })
      ).json()) as { id: string }

      shareAway(stack, bot.sessionId, me.id)
      const archived = await fetch(`${stack.apiUrl}/agent/conversations/${bot.sessionId}/archive`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: stack.teamId, archived: true }),
      })

      if (!archived.ok) throw new Error(`Archiving the Bot answered ${String(archived.status)}`)
      // The scenarios after this one run in the E2E Bot's chat.
      await openChat(page, 'E2E Bot')
      await until(
        `${SHARED} to leave the Bots list`,
        async () =>
          (await page.locator('[data-sidebar-row]').filter({ hasText: SHARED }).count()) === 0,
      )
    },
  },
]
