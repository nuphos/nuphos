// Scenarios about a Bot reading its chat. They run in the Bot chat the scenario before opened.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { agentEvents, agentLog } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { botAccessScenarios } from './bot-access-scenarios.ts'
import {
  computerWithUsage,
  loadingFree,
  pickRuntime,
  shootChipResets,
  shootRuntimeLine,
  shootUsageResets,
} from './channel-helpers.ts'
import { checkDockToggleClear } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { screencast } from './question-scenarios.ts'
import { newTask, send, transcriptPost } from './ui.ts'

import type { Scenario } from './ui.ts'

/** One scenario per file in ./channel, its default export, in file-name order. */
async function scenarioFiles(): Promise<Scenario[]> {
  const dir = join(import.meta.dirname, 'channel')

  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .sort()

  return Promise.all(
    files.map(async (file) => ((await import(join(dir, file))) as { default: Scenario }).default),
  )
}

export const channelScenarios: Scenario[] = [
  {
    name: "the Bot chat's header ends left of the workspace panel toggle",
    run: async (page) => {
      await checkDockToggleClear(page, 'Bot chat header')
    },
  },
  {
    // #2949: channel_read in a woken turn returned the page the notice had shown, not the rest.
    name: 'a Bot woken by more than a page of posts reads on to the newest one',
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail
      const post = async (text: string) => {
        const response = await fetch(
          `${stack.apiUrl}/agent/conversations/${channelId ?? ''}/channel-messages`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${stack.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ teamId: stack.teamId, text }),
          },
        )

        if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
      }

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      // The first keeps the Bot busy, so the next 52 wait for one notice of more than a page.
      await post('Hold on E2E_SLOW E2E_DELIVERY:slow')
      for (let n = 0; n < 51; n++) await post(`Burst ${String(n)}`)
      await post('The newest E2E_DELIVERY:newest')
      // The Bot posts only once it has read on, so any repeat is logged by now.
      await transcriptPost(page, 'POSTED E2E_DELIVERY:newest').waitFor()
      const repeats = agentLog(stack).filter((entry) => entry.event === 'channel-repeat')

      if (repeats.length > 0) {
        throw new Error(
          `channel_read returned posts the notice had shown: ${JSON.stringify(repeats)}`,
        )
      }
    },
  },
  {
    // #3702: a Bot answers one post with replyTo, and its answer quotes that post.
    name: "a Bot's answer to one post quotes it",
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            teamId: stack.teamId,
            text: 'Which regions are down? E2E_REPLY_TO E2E_DELIVERY:reply',
          }),
        },
      )

      if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
      await transcriptPost(page, 'POSTED E2E_DELIVERY:reply').waitFor()
      // The quote above the answer is a button titled with the post it answers.
      await page.locator('button[title^="Which regions are down? E2E_REPLY_TO"]').waitFor()
    },
  },
  {
    // #3246: every Bot post was headed by the Bot's name and an "Agent" tag.
    name: "a Bot's posts are headed by its name, with no Agent tag",
    run: async (page) => {
      const posts = page.locator('[data-post-id]')

      await posts.first().waitFor()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await page.screenshot({ path: `${artifacts}/bot-post-header-light.png` })
      const tags = await posts.getByText('Agent', { exact: true }).count()

      if (tags > 0) throw new Error(`${String(tags)} Bot posts carry an Agent tag`)
    },
  },
  {
    // #3171: a busy Bot's row showed what the Bot last told its owner, never posted in its chat.
    name: 'a Bot that posts twice and works on shows dots in its row, then its newest post',
    run: async (page, stack) => {
      const row = page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      const ownWords = async (when: string) => {
        // The fixture's own turn text, which only the Bot's transcript holds.
        if ((await row.getByText(/ACK E2E_DELIVERY/).count()) > 0)
          throw new Error(`${when}, the Bot's row shows the Bot's own transcript`)
      }

      // Setup has its own status line. Finish it before checking an established Bot's dots.
      await send(
        page,
        'Confirmed: review releases. E2E_ONBOARDING_COMPLETE E2E_DELIVERY:busy-bot-setup',
      )
      await until('the Bot setup turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:busy-bot-setup'),
      )
      await row.getByText('Getting started', { exact: true }).waitFor({ state: 'hidden' })
      // The chat and its sidebar row side by side, typing → posts → idle (#3522).
      const stop = await screencast(page, 'bot-row-typing-sync')

      try {
        await send(page, 'Post twice E2E_TWO_POSTS E2E_DELIVERY:two')
        await transcriptPost(page, 'POSTED E2E_DELIVERY:two').waitFor()
        // Still in its turn: the row has the dots exactly while the chat types.
        await row.locator('.t-typing-dot').first().waitFor()
        await page.getByRole('status', { name: 'E2E Bot is thinking' }).waitFor()
        // The chat's bubble opens after a beat; let it draw before the capture.
        await page.waitForTimeout(1_000)
        await page.screenshot({ path: `${artifacts}/bot-row-busy-light.png` })
        await loadingFree(row, 'While the Bot works')
        await ownWords('While the Bot works')
        await until('the two-post turn to finish', async () =>
          agentEvents(stack).includes('finish E2E_DELIVERY:two'),
        )
        // Both dots close together, and the row shows the chat's newest post.
        await page.getByRole('status', { name: 'E2E Bot is thinking' }).waitFor({ state: 'hidden' })
        await row.locator('.t-typing-dot').first().waitFor({ state: 'detached' })
        await row.getByText('POSTED E2E_DELIVERY:two').waitFor()
        await page.waitForTimeout(1_000)
      } finally {
        await stop()
      }
      await page.screenshot({ path: `${artifacts}/bot-row-idle-light.png` })
      await ownWords('After the turn')
    },
  },
  {
    // #3319: a Bot's chat kept a name of its own, so a renamed Bot still showed its old one.
    name: "renaming a Bot's chat renames the Bot, and every place it shows follows",
    run: async (page, stack) => {
      const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail
      const rename = async (title: string) => {
        const response = await fetch(
          `${stack.apiUrl}/agent/conversations/${channelId ?? ''}/title`,
          {
            method: 'PATCH',
            headers: {
              authorization: `Bearer ${stack.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ teamId: stack.teamId, title }),
          },
        )

        if (!response.ok) throw new Error(`Renaming failed: ${String(response.status)}`)
      }

      if (!channelId) throw new Error('The Bot has not answered in its chat yet')
      await rename('E2E Scout')
      try {
        const rows = page.locator('[data-sidebar-row]')

        await rows.filter({ hasText: 'E2E Scout' }).first().waitFor()
        await page.locator('.workspace-agent-titlebar').getByText('E2E Scout').first().waitFor()
        await page.getByText('Message E2E Scout', { exact: true }).waitFor()
        await page.locator('[data-post-id]').filter({ hasText: 'E2E Scout' }).first().waitFor()
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/bot-renamed-light.png` })
        const stale = await rows.filter({ hasText: 'E2E Bot' }).count()

        if (stale > 0) throw new Error(`${String(stale)} sidebar rows still show the old name`)
      } finally {
        // Later scenarios find the Bot by its name.
        await rename('E2E Bot')
      }
      await page.getByText('Message E2E Bot', { exact: true }).waitFor()
      // Renamed from outside the app, the Bot's sidebar row follows on its own, with no reload.
      await page
        .locator('[data-sidebar-row]')
        .filter({ hasText: 'E2E Bot' })
        .first()
        .waitFor({ timeout: 10_000 })
    },
  },
  ...botAccessScenarios,
  {
    // #3310: the Bot's name above its Inbox question opened the Bot's session as a Task,
    // with the sidebar left on the Inbox.
    name: "a Bot's name above its Inbox question opens the Bot's chat, with Bots in the sidebar",
    run: async (page, stack) => {
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:inbox-bot')
      await transcriptPost(page, 'POSTED E2E_DELIVERY:inbox-bot').waitFor()
      await page.getByRole('tab', { name: /^Inbox/ }).click()
      const source = page.locator('article header').getByRole('button', { name: 'E2E Bot' })

      await source.waitFor()
      await page.screenshot({ path: `${artifacts}/inbox-bot-source-light.png` })
      await source.click()
      // The Bot's chat, not its own session: only the chat's composer is headed by its name.
      await page.locator('[aria-placeholder="Message E2E Bot"]').waitFor()
      await page.getByRole('tab', { name: /^Bots/, selected: true }).waitFor({ timeout: 5_000 })
      // The sidebar slides over to Bots; shoot it once it has.
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: `${artifacts}/inbox-bot-opened-light.png` })
      // #4065: a link in the Bot's question card opens in the dock, as in a Task's
      // chat, never in the system browser.
      await page.locator('[data-open-question] a[href$="/health/ready"]').last().click()
      const address = page.getByRole('textbox', { name: 'Search or enter URL' })

      await address.waitFor({ timeout: 10_000 })
      must(
        (await address.inputValue()).endsWith('/health/ready'),
        `the dock's browser to open the card's link, got ${await address.inputValue()}`,
      )
      await page.screenshot({ path: `${artifacts}/bot-question-link-dock-light.png` })
      await page.getByRole('button', { name: 'Close workspace panel' }).click()
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).last().click()
      await until('the answer in the Bot chat to reach the Bot', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
      )
    },
  },
  {
    // #3252: the Bot composer's runtime line hid the usage bar the Task composer shows.
    name: 'the Bot composer and the Task composer both show the runtime usage bar',
    run: async (page, stack) => {
      const computer = 'E2E usage computer'
      const fixture = 'E2E fixture agent'
      const forget = await computerWithUsage(stack, computer)

      try {
        // Still in the Bot chat the scenarios before opened.
        await pickRuntime(page, computer, /^Claude Code/)
        const bot = await shootRuntimeLine(page, 'bot')

        await pickRuntime(page, fixture, /^E2E fixture agent.*Claude Code/)
        await newTask(page)
        await pickRuntime(page, computer, /^Claude Code/)
        const task = await shootRuntimeLine(page, 'task')

        // The quota tooltip names when its tightest window, the 5-hour one, resets.
        await shootChipResets(page)

        await pickRuntime(page, fixture, /^E2E fixture agent.*Claude Code/)
        if (!bot || !task) throw new Error(`Usage bar: Bot ${String(bot)}, Task ${String(task)}`)
        await shootUsageResets(page, computer)
      } finally {
        forget()
      }
    },
  },
  // A new channel scenario is a file of its own in ./channel, not one more entry here.
  ...(await scenarioFiles()),
]
