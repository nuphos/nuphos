// What a Bot may use, set in its details. Runs in the Bot chat the scenarios before opened.
import { agentLog } from './agent-log.ts'
import { botNamed, updateBot } from './bot-access-db.ts'
import { access, details, narrowDetails, shoot } from './bot-details-narrow.ts'
import { until } from './processes.ts'
import { openBotTask, send, setBotDetails } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const CHOOSE = "This Bot can't use any computers yet. Choose what it may use."
const UNCHOSEN = 'Unchosen access Bot'

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

/** The composer in front: a Bot chat stays mounted, inert, behind the Bot's own page. */
const composer = (page: Page) =>
  page.locator(
    "xpath=//*[contains(concat(' ', @class, ' '), ' composer-surface ')][not(ancestor::*[@inert])] >> visible=true",
  )

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
        !made.access.allCredentials ||
        !made.access.allDevices
      )
        throw new Error(`"+" stored ${JSON.stringify(made?.access)}, not its owner's default`)
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

      // A turn in its chat runs a command on its owner's computer, which it may now use.
      const from = agentLog(stack).length
      const args = JSON.stringify({
        label: 'Run it',
        command: 'echo E2E_ON_COMPUTER',
        device: deviceIds[0],
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

      // Custom: unticking a computer leaves All and stores what is ticked; the switch brings
      // All back. This team has no credentials; mcp-credential-defaults narrows those.
      await access(page)
        .getByRole('button', { name: /^Computers/ })
        .click()
      const menu = page.getByRole('menu')

      await menu.getByRole('menuitemcheckbox', { checked: true }).first().click()
      await until('unticking a computer to leave All', async () => {
        const now = botNamed(stack, 'E2E Bot')?.access

        return Boolean(now && !now.allDevices && (now.deviceIds?.length ?? 0) < deviceIds.length)
      })
      await shoot(page, 'custom-computers')
      await menu.getByRole('switch').click()
      await until('the switch to bring All back', async () =>
        Boolean(botNamed(stack, 'E2E Bot')?.access?.allDevices),
      )
      await page.keyboard.press('Escape')
      await menu.waitFor({ state: 'detached' })
      const narrowed = botNamed(stack, 'E2E Bot')?.access

      if (JSON.stringify(narrowed?.deviceIds) !== JSON.stringify(deviceIds))
        throw new Error(`All again stored ${JSON.stringify(narrowed)}`)

      await narrowDetails(page)

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
    // A Bot made before #4158 asks to choose what it uses; switching Bots keeps details open.
    name: 'a Bot with no stored access asks to choose, and switching Bots keeps its details open',
    run: async (page, stack) => {
      const response = await fetch(`${stack.apiUrl}/agent/bots`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          teamId: stack.teamId,
          title: UNCHOSEN,
          avatar: '07-ada',
          agentRuntime: 'claude-code',
        }),
      })

      if (!response.ok) throw new Error(`Making a Bot answered ${String(response.status)}`)
      const bot = (await response.json()) as { sessionId: string }

      // A Bot made before #4158 stored no selection, and is asked to choose.
      updateBot(stack, bot.sessionId, { $unset: { credentialAccess: '' } })

      await openChat(page, UNCHOSEN)
      // #4038: in a chat with no posts the banner sits in the intro's column, 16px under it.
      const intro = page
        .getByText(`This is where you and ${UNCHOSEN} get things done.`, { exact: false })
        .locator('xpath=..')
      const banner = page.getByText(CHOOSE).locator('xpath=..')

      await banner.waitFor()
      const [text, line] = await Promise.all([intro.boundingBox(), banner.boundingBox()])

      if (
        !text ||
        !line ||
        Math.abs(line.x - text.x) > 1 ||
        Math.abs(line.y - (text.y + text.height) - 16) > 1
      )
        throw new Error(`The banner is not under the intro: ${JSON.stringify({ text, line })}`)
      await shoot(page, 'empty-chat-banner')
      await setBotDetails(page, true)
      // #4072: switching Bots with the details open keeps them open, with no slide-in again.
      await openChat(page, 'E2E Bot')
      await details(page).waitFor()
      const motion = await details(page).evaluate((panel) => ({
        classes: `${panel.className} ${panel.parentElement?.className ?? ''}`,
        running: document
          .getAnimations()
          .map((animation) => (animation as CSSAnimation).animationName)
          .filter((name) => name?.startsWith('t-summary')),
      }))

      if (/t-summary(-slot)?-in/.test(motion.classes) || motion.running.length > 0)
        throw new Error(`Bot details slid in again on switching Bots: ${JSON.stringify(motion)}`)
      await shoot(page, 'switched-open')
      await setBotDetails(page, false)
      // Later scenarios list Bots by name, so it is archived with its chat.
      await archive(stack, bot.sessionId)
      // The scenarios after this one run in the E2E Bot's chat.
      await openChat(page, 'E2E Bot')
      await until(
        `${UNCHOSEN} to leave the Bots list`,
        async () =>
          (await page.locator('[data-sidebar-row]').filter({ hasText: UNCHOSEN }).count()) === 0,
      )
    },
  },
]
