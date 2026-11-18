// Scenarios about the sidebar itself.
import { agentEvents } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { checkDockToggleClear } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

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
]

export const botFoldScenarios: Scenario[] = [
  {
    // #2898: a Bot's tree opened by hand folded again whenever Bots was left.
    name: 'a Bot tree opened by hand stays open after Tasks and back, and after a reload',
    run: async (page, stack) => {
      const count = (event: string) =>
        agentEvents(stack).filter((logged) => logged === event).length
      const introductions = count('finish E2E_DELIVERY:missing')
      const dispatched = count('start E2E_DELIVERY:inherit-child')
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
      // The sub-agent stays in its turn, so it stays in the tree: a finished one would sit
      // behind the done badge, which was remembered before #2898 too.
      await send(page, 'Dispatch a sub-agent E2E_INHERIT E2E_KEEP_CHILD E2E_DELIVERY:fold')
      await until(
        'the sub-agent to start',
        async () => count('start E2E_DELIVERY:inherit-child') > dispatched,
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
    },
  },
]
