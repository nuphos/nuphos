// What a Bot may use, set in its details. Runs in the Bot chat the scenarios before opened.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openBotTask, send, setBotDetails } from './ui.ts'

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

type StoredAccess = {
  awsRoleIds?: string[]
  deviceIds?: string[]
  resendIntegrationIds?: string[]
} | null

/** A Bot's stored credentialAccess, by its name; null until there is one. */
function botNamed(stack: Stack, title: string) {
  return mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    const bot = await bots.findOne({ title: process.argv[2], avatar: { $exists: true } })
    console.log(bot ? JSON.stringify({ sessionId: bot.sessionId, access: bot.credentialAccess ?? null }) : '')
    await client.close()`,
    title,
  ) as { sessionId: string; access: StoredAccess } | null
}

/** Updates a Bot's record where no route does what a scenario needs. */
function updateBot(stack: Stack, sessionId: string, update: object) {
  mongo(
    stack,
    `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    await bots.updateOne({ sessionId: process.argv[2] }, JSON.parse(process.argv[3]))
    await client.close()`,
    sessionId,
    JSON.stringify(update),
  )
}

/** Archives a conversation and its chat, so later scenarios don't list it. */
async function archive(stack: Stack, sessionId: string) {
  const archived = await fetch(`${stack.apiUrl}/agent/conversations/${sessionId}/archive`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: stack.teamId, archived: true }),
  })

  if (!archived.ok) throw new Error(`Archiving the Bot answered ${String(archived.status)}`)
}

// A Task's linked issue; no route links one without a provider.
const ISSUE = {
  id: 'e2e-issue',
  provider: 'linear',
  title: 'E2E linked issue',
  url: 'https://linear.app/e2e/issue/E2E-1',
  state: 'open',
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
    // #4158: a Bot made with "+" may use everything its owner may, as a new chat does, and
    // its turns reach a computer. Before, it stored nothing and could use none of them.
    // #3790: what it may use is shown and changed in Bot details, not in its chat's composer.
    name: 'a Bot made with "+" may use every credential and computer of its owner',
    run: async (page, stack) => {
      const made = botNamed(stack, 'E2E Bot')
      const deviceIds = made?.access?.deviceIds ?? []

      if (
        !made?.access?.awsRoleIds ||
        !deviceIds.length ||
        made.access.resendIntegrationIds?.length
      )
        throw new Error(`"+" stored ${JSON.stringify(made.access)}, not its owner's default`)
      if ((await page.getByText(CHOOSE).count()) > 0)
        throw new Error('A Bot that may use everything is asked to choose')
      if ((await composerAccess(page)) > 0)
        throw new Error("The Bot chat's composer still offers credentials, computers or a mode")
      await setBotDetails(page, true)
      for (const row of [/^Credentials/, /^Computers/, /^Full Access/])
        await access(page).getByText(row).first().waitFor()
      await shoot(page, 'owner')
      await shootMenu(page, /^Computers/, 'menu-computers')
      await shootMenu(page, /^Credentials/, 'picker')
      await shootMenu(page, /^Authorization mode/, 'menu-mode')

      // A Bot its agent makes with create_bot gets what that agent may use, never more.
      await send(
        page,
        'Make one E2E_CALL create_bot {"label":"Make","name":"E2E Made Bot"} E2E_DELIVERY:bot-made',
      )
      await until('create_bot to make a Bot', async () => botNamed(stack, 'E2E Made Bot'))
      const minted = botNamed(stack, 'E2E Made Bot')

      if (!minted || JSON.stringify(minted.access?.deviceIds) !== JSON.stringify(deviceIds))
        throw new Error(`create_bot stored ${JSON.stringify(minted?.access)}, not its maker's`)
      await archive(stack, minted.sessionId)

      // A turn in its chat runs a command on a computer it may use: one running `nuphos agent`,
      // as every local_exec scenario uses, added to what it stored.
      const computer = await startSecondComputer(stack, 'E2E Bot computer')

      try {
        updateBot(stack, made.sessionId, {
          $set: { 'credentialAccess.deviceIds': [...deviceIds, computer.deviceId] },
        })
        const from = agentLog(stack).length
        const args = JSON.stringify({
          label: 'Run it',
          command: 'echo E2E_ON_COMPUTER',
          device: computer.deviceId,
        })

        await send(page, `Run it E2E_CALL local_exec ${args} E2E_DELIVERY:bot-computer`)
        await until('the Bot to run a command on a computer', async () =>
          agentLog(stack)
            .slice(from)
            .some(
              (entry) =>
                entry.event === 'called' &&
                entry.name === 'local_exec' &&
                JSON.stringify(entry.result).includes('E2E_ON_COMPUTER'),
            ),
        )
      } finally {
        updateBot(stack, made.sessionId, { $set: { 'credentialAccess.deviceIds': deviceIds } })
        await computer.stop()
        forgetComputer(stack.mongoUri, computer.deviceId)
      }

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
      updateBot(stack, made.sessionId, {
        $set: { linkedResources: [{ ...ISSUE, linkedAt: new Date().toISOString() }] },
      })
      await page.reload()
      await access(page).waitFor()
      if ((await details(page).getByRole('region', { name: 'Changes', exact: true }).count()) > 0)
        throw new Error('Bot details show Changes')
      await shoot(page, 'no-changes')
      updateBot(stack, made.sessionId, { $unset: { linkedResources: '' } })

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
      // Handed to a member, letting the team read it.
      updateBot(stack, bot.sessionId, { $set: { userId: mate.id, generalAccess: 'team' } })
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

      updateBot(stack, bot.sessionId, { $set: { userId: me.id, generalAccess: 'team' } })
      await archive(stack, bot.sessionId)
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
