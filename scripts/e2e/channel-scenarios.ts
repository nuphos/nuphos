// Scenarios about a Bot reading its chat. They run in the Bot chat the scenario before opened.
import { randomUUID } from 'node:crypto'

import { agentEvents, agentLog } from './agent-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** A computer whose Claude Code reports usage with its status, as Desktop's host does. */
async function computerWithUsage(stack: Stack, label: string) {
  const deviceId = randomUUID()
  const auth = { authorization: `Bearer ${stack.token}` }
  const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, label, platform: 'darwin', allowLocalExec: true }),
  })

  if (!registered.ok) throw new Error(`Registering answered ${String(registered.status)}`)
  const host = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
    { headers: auth } as unknown as string[],
  )

  host.addEventListener('message', (event) => {
    if (String(event.data).includes('"ping"')) host.send(JSON.stringify({ t: 'pong' }))
  })
  await new Promise((opened, failed) => {
    host.addEventListener('open', opened)
    host.addEventListener('error', failed)
  })
  const resetsAt = new Date(Date.now() + 3 * 3_600_000).toISOString()
  const usage = {
    five_hour: { utilization: 35, resets_at: resetsAt },
    seven_day: { utilization: 20, resets_at: resetsAt },
  }

  host.send(
    JSON.stringify({
      t: 'status',
      status: {
        agents: {
          'claude-code': {
            cli: { installed: true, loggedIn: true },
            usage,
            usageAt: new Date().toISOString(),
          },
        },
      },
    }),
  )

  return () => {
    host.close()
    forgetComputer(stack.mongoUri, deviceId)
  }
}

/** Puts the composer on a runtime: `row` opens its submenu and `item` names the runtime in it. */
async function pickRuntime(page: Page, row: string, item: RegExp) {
  await page.getByRole('button', { name: /^Agent runtime/ }).click()
  await page.getByRole('menu').getByText(row).first().click({ timeout: 60_000 })
  await page.getByRole('menuitem', { name: item }).last().click()
}

/** Shoots the composer in light; whether its runtime line shows the usage bar. */
async function shootRuntimeLine(page: Page, name: string) {
  const bar = page.getByRole('progressbar', { name: 'Usage remaining' })
  const path = `${artifacts}/${name}-composer-light.png`

  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await bar.waitFor({ timeout: 30_000 }).catch(() => undefined)
  await page.waitForTimeout(500)
  await page.locator('.composer-surface:visible').last().screenshot({ path })

  return (await bar.count()) > 0
}

export const channelScenarios: Scenario[] = [
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
      await page.getByText('POSTED E2E_DELIVERY:newest', { exact: true }).waitFor()
      const repeats = agentLog(stack).filter((entry) => entry.event === 'channel-repeat')

      if (repeats.length > 0) {
        throw new Error(
          `channel_read returned posts the notice had shown: ${JSON.stringify(repeats)}`,
        )
      }
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
      await send(page, 'Post twice E2E_TWO_POSTS E2E_DELIVERY:two')
      await page.getByText('POSTED E2E_DELIVERY:two', { exact: true }).waitFor()
      // Still in its turn: the row has the work dots.
      await row.locator('.t-typing-dot').first().waitFor()
      await page.screenshot({ path: `${artifacts}/bot-row-busy-light.png` })
      await ownWords('While the Bot works')
      await until('the two-post turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:two'),
      )
      await row.getByText('POSTED E2E_DELIVERY:two').waitFor()
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

        await pickRuntime(page, fixture, /^E2E fixture agent.*Claude Code/)
        if (!bot || !task) throw new Error(`Usage bar: Bot ${String(bot)}, Task ${String(task)}`)
      } finally {
        forget()
      }
    },
  },
]
