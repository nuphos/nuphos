// Scenarios about a Bot's own session, opened over its chat. They run after the runtime
// scenarios: they leave the Bot on the second agent, which those need unused until then.
import { agentEvents, agentLog } from './agent-log.ts'
import { must } from './binding-access-scenarios.ts'
import { checkDockToggleClear } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { openBotTask, pickInRow, send, setBotDetails } from './ui.ts'

import type { Scenario } from './ui.ts'

export const botTurnScenarios: Scenario[] = [
  {
    // #3309: Switch runtime in a Bot's own failed turn also opened its chat's list, underneath.
    name: "Switch runtime on a Bot's failed turn opens one runtime list",
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:bot-usage'

      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await page.getByText('Message E2E Bot', { exact: true }).waitFor()
      await openBotTask(page)
      const task = page.locator('.t-bot-task-mode:visible')

      await task.getByRole('button', { name: 'Toggle task summary' }).waitFor()
      // The Task slides in from the right; its header is measured once it has arrived.
      await page.waitForFunction(() => {
        const box = document.querySelector('.t-bot-task-mode')?.getBoundingClientRect()

        return box !== undefined && box.right <= window.innerWidth + 1
      })
      await page.waitForTimeout(300)
      // #3561: the Task's header kept its summary toggle under the workspace panel toggle.
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          document.documentElement.classList.remove('light', 'dark')
          document.documentElement.classList.add(value)
        }, theme)
        await checkDockToggleClear(page, `Bot Task header ${theme}`, '.t-bot-task-mode header')
        await page.getByRole('button', { name: 'Open workspace panel' }).click()
        await page.getByRole('button', { name: 'Close workspace panel' }).waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({
          path: `${artifacts}/dock-toggle-Bot-Task-header-${theme}-open.png`,
        })
        await page.getByRole('button', { name: 'Close workspace panel' }).click()
        await page.getByRole('button', { name: 'Open workspace panel' }).waitFor()
      }
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      await task.getByRole('textbox').last().click()
      await page.keyboard.type(`Out of usage E2E_USAGE_LIMIT ${marker}`)
      await page.keyboard.press('Enter')
      await task.getByText('You’ve hit your usage limit').last().waitFor()
      await task.getByRole('button', { name: 'Switch runtime' }).click()
      const lists = page.getByRole('menu')

      await lists.first().waitFor()
      // Long enough for a second list to have opened, had there been one.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await page.screenshot({ path: `${artifacts}/bot-turn-switch-runtime-light.png` })
      const open = await lists.count()

      if (open !== 1) throw new Error(`Switch runtime opened ${String(open)} runtime lists`)
      // The refused turn stays with the Bot and would ride along with its next turn, so the
      // Bot moves on from this list and the turn runs once on the second agent. It stays there.
      await pickInRow(page, 'E2E second agent', /^E2E second agent.*Claude Code/)
      await until('the refused turn to finish on the second agent', async () =>
        agentLog(stack).some(
          (entry) =>
            entry.agent === 'second' && entry.marker === marker && entry.event === 'finish',
        ),
      )
      await task.getByRole('button', { name: 'Back to conversation' }).click()
      // The scenarios after this one find a single composer on the page, and the chat at full width.
      await task.waitFor({ state: 'detached' })
      await setBotDetails(page, false)
    },
  },
  {
    // #3481: a Bot chat learned its Bot's turn had ended only from the 4 s session poll, so its
    // header kept saying Thinking for up to 4 s after the turn.
    name: "a Bot chat's header stops saying Thinking within 2.5 s of the turn",
    run: async (page, stack) => {
      const marker = 'E2E_DELIVERY:pill-clears'
      const thinking = page.locator('.workspace-agent-titlebar').getByText('Thinking…')
      const introductions = agentEvents(stack).filter(
        (event) => event === 'finish E2E_DELIVERY:missing',
      ).length

      // A Bot of its own: a Bot with an open question says so instead of Thinking.
      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await page.getByRole('menuitem', { name: 'New Bot' }).click()
      await page.getByRole('textbox', { name: 'Bot name' }).fill('Pill Bot')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await until(
        'the new Bot to introduce itself',
        async () =>
          agentEvents(stack).filter((event) => event === 'finish E2E_DELIVERY:missing').length >
          introductions,
      )
      // E2E_SLOW keeps the turn going long enough for the 4 s poll to see it start.
      await send(page, `Work a while E2E_SLOW ${marker}`)
      await thinking.first().waitFor({ timeout: 30_000 })
      // Checked every 50 ms, closer than `until`, since the end's time is what this measures.
      for (
        const deadline = Date.now() + 60_000;
        !agentEvents(stack).includes(`finish ${marker}`);
      ) {
        must(Date.now() < deadline, 'the Bot to finish its turn')
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const finished = Date.now()

      await thinking.first().waitFor({ state: 'detached', timeout: 10_000 })
      const lag = Date.now() - finished

      await page.screenshot({ path: `${artifacts}/bot-chat-turn-ended.png` })
      // TODO(#3604): back to 1.5 s once the chat follows the turn's end. Until then the
      // 1 s poll lands every ~1.3 s, so an end right after a listing takes up to ~1.8 s.
      must(lag <= 2_500, `the header to stop saying Thinking within 2.5 s, took ${String(lag)} ms`)
      // #3970: a Bot's own session compacts at a 200k window and skips next-prompt suggestions.
      const log = agentLog(stack)
      const turn = log.find((entry) => entry.event === 'finish' && entry.marker === marker)
      const session = log.find(
        (entry) => entry.event === 'session' && entry.sessionId === turn?.sessionId,
      )

      must(
        session?.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '200000' &&
          session.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION === '0',
        `the Bot's session to carry its Claude Code settings: ${JSON.stringify(session?.env)}`,
      )
    },
  },
]
