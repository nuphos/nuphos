// Scenarios about the sidebar itself.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { checkDockToggleClear } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
// The bottom fade in sidebar-pages.css.
const FADE = 26

/** Copies the conversation `count` times, or deletes the copies again: enough Tasks to scroll. */
function seedTasks(mongoUri: string, sessionId: string, count: number) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, sessionId, count] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const tasks = client.db('nuphos_e2e').collection('agent_conversations')
    await tasks.deleteMany({ sessionId: { $regex: '^seeded-task-' } })
    const { _id, ...task } = await tasks.findOne({ sessionId })
    if (Number(count) > 0) await tasks.insertMany(Array.from({ length: Number(count) }, (_, n) => {
      const title = 'Seeded task ' + String(n + 1).padStart(2, '0')
      return { ...task, sessionId: 'seeded-task-' + n, title, firstMessage: title }
    }))
    await client.close()`

  execFileSync('bun', ['-e', script, mongoUri, sessionId, String(count)], {
    cwd: BACKEND_DIR,
    timeout: 20_000,
  })
}

export const sidebarScenarios: Scenario[] = [
  {
    // The pages' viewport was `overflow: hidden`, which focus still scrolls: every page showed cut off.
    name: 'every sidebar page shows from its left edge, never scrolled sideways',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Hello E2E_DELIVERY:sidebar')
      await page.getByText('ACK E2E_DELIVERY:sidebar').waitFor()
      await checkDockToggleClear(page, 'Task chat header')
      // Open, the dock's tab strip is what runs under the toggle.
      await page.getByRole('button', { name: 'Open workspace panel' }).click()
      await page.getByRole('button', { name: 'Close workspace panel' }).waitFor()
      await page.waitForTimeout(500)
      await checkDockToggleClear(page, 'dock tab strip', '[class*="--dock-toggle-pad"]')
      await page.getByRole('button', { name: 'Close workspace panel' }).click()
      for (const tab of ['Tasks', 'Inbox', 'Bots']) {
        await page.getByRole('tab', { name: tab }).click()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${artifacts}/sidebar-${tab.toLowerCase()}.png` })
        const sideways = await page.evaluate(
          () => document.querySelector('.sidebar-swipe-viewport')?.scrollLeft,
        )

        must(sideways === 0, `the ${tab} page not to be scrolled sideways, got ${String(sideways)}`)
      }
    },
  },
  {
    // #3429: the list kept 8px under its last row while its fade covers 26px.
    name: 'a long Tasks list scrolled to its end shows its last row clear of the bottom fade',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const { conversations } = (
        await api(
          'GET',
          `/agent/conversations?teamId=${stack.teamId}&search=E2E_DELIVERY%3Asidebar`,
        )
      ).body as { conversations: { sessionId: string }[] }
      const task = conversations[0]?.sessionId

      must(Boolean(task), 'the sidebar scenario to have left a Task')
      seedTasks(stack.mongoUri, task ?? '', 40)
      try {
        await page.reload()
        await page.getByRole('tab', { name: 'Tasks' }).click()
        await page.getByText('Seeded task 01', { exact: true }).waitFor()
        const end = async () =>
          page.evaluate(() => {
            const pages = document.querySelector('.sidebar-swipe-viewport')?.getBoundingClientRect()
            const list = [...document.querySelectorAll<HTMLElement>('.sidebar-page-list')].find(
              (node) => {
                const box = node.getBoundingClientRect()

                return (
                  pages &&
                  box.width > 0 &&
                  box.left >= pages.left - 1 &&
                  box.right <= pages.right + 1
                )
              },
            )
            const rows = list?.querySelectorAll('[data-sidebar-row]')
            const last = rows?.[rows.length - 1]

            if (!list || !last) return null
            list.scrollTop = list.scrollHeight

            return {
              scrolls: list.scrollHeight > list.clientHeight,
              room: list.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
            }
          })

        await end()
        await page.waitForTimeout(300)
        const shown = await end()

        await page.screenshot({ path: `${artifacts}/sidebar-tasks-end-light.png` })
        must(shown?.scrolls === true, 'the seeded Tasks list to scroll')
        must(
          (shown?.room ?? 0) >= FADE,
          `the last Task row to end at least ${String(FADE)}px above the list's bottom, got ${String(shown?.room)}px`,
        )
      } finally {
        seedTasks(stack.mongoUri, task ?? '', 0)
        await page.reload()
      }
    },
  },
]

export const botFoldScenarios: Scenario[] = [
  {
    // #2898: a Bot's tree opened by hand folded again whenever Bots was left.
    name: 'a Bot tree opened by hand stays open after Tasks and back, and after a reload',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const count = (event: string) =>
        agentEvents(stack).filter((logged) => logged === event).length
      const introductions = count('finish E2E_DELIVERY:missing')
      const asked = count('permission-asked E2E_DELIVERY:thread')
      // Its own Bot, so no scenario before it decides what the tree holds.
      const row = page.locator('[data-sidebar-row]').filter({ hasText: 'Fold Bot' }).first()
      const show = row.locator('[aria-label="Show sub-agents"]')
      const hide = row.locator('[aria-label="Hide sub-agents"]')
      const mustBeOpen = async (when: string) => {
        await until(
          `the Bot tree to show ${when}`,
          async () => (await show.count()) + (await hide.count()) === 1,
        )
        must((await hide.count()) === 1, `the opened Bot tree to stay open ${when}`)
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      // Bots already exist here, so New Bot sits in the + menu.
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByRole('menuitem', { name: 'New Bot' }).click()
      await page.getByRole('textbox', { name: 'Bot name' }).fill('Fold Bot')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await until(
        'the new Bot to introduce itself',
        async () => count('finish E2E_DELIVERY:missing') > introductions,
      )
      const bots = await api('GET', `/agent/conversations?teamId=${stack.teamId}&bots=true`)
      const bot = (bots.body as { conversations: { sessionId: string }[] }).conversations[0]!
      // Out of Full Access, its sub-agent waits for a person to allow its command and so stays
      // in the tree: a finished one sits behind the done badge, remembered before #2898 too.
      const mode = await api('PUT', '/agent/auto-mode/bypass', {
        sessionId: bot.sessionId,
        bypass: false,
      })

      must(mode.status === 200, `the Bot to leave Full Access, got ${String(mode.status)}`)
      await send(page, 'Start a thread E2E_THREAD E2E_DELIVERY:fold')
      await until(
        'the sub-agent to wait on its command',
        async () => count('permission-asked E2E_DELIVERY:thread') > asked,
      )
      // Folded until someone opens it.
      await show.click()
      await mustBeOpen('once opened')
      await page.getByRole('tab', { name: 'Tasks' }).click()
      await page.getByRole('button', { name: 'New task', exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Bots' }).click()
      await mustBeOpen('after Tasks and back')
      await page.reload()
      await page.getByRole('tab', { name: 'Bots' }).click()
      await mustBeOpen('after a reload')
      await page.screenshot({ path: `${artifacts}/bot-tree-open-after-reload.png` })
      // Stop the waiting sub-agent, so the scenarios after this one find the computer free.
      const answered = () =>
        agentEvents(stack).filter(
          (event) => /^permission-(?!asked)/.test(event) && event.endsWith(' E2E_DELIVERY:thread'),
        ).length
      const before = answered()

      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E thread' }).first().click()
      await page.locator('button[title="Stop"]').click()
      await until('the stopped sub-agent to let go of its command', async () => answered() > before)
      // Back in the Bot chat, where the scenarios after this one found the window before.
      await row.click()
    },
  },
]
