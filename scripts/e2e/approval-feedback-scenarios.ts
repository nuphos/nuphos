// #3999: replying in chat while a command is being prepared explains why its
// approval was superseded, even after the turn and command details fold away.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const approvalFeedbackScenarios: Scenario[] = [
  {
    name: 'a chat reply cancels the pending approval with visible retry guidance, without approving',
    run: async (page, stack) => {
      const sessionId = randomUUID()
      const prompt = 'Run a safe test command. E2E_PERMISSION E2E_DELIVERY:approval-feedback'
      let release = stack.holdSessionOpening()

      try {
        const as = client(stack.apiUrl, stack.token)
        const asked = await as('POST', '/mcp', {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'nuphos_ask',
            arguments: {
              team_id: stack.teamId,
              session_id: sessionId,
              prompt,
              full_access: false,
              wait: false,
            },
          },
        })

        must(asked.status === 200, `the task to start, got ${asked.text}`)
        await page.getByRole('tab', { name: 'Tasks' }).click()
        await page
          .locator('[data-sidebar-row]')
          .filter({ hasText: 'Run a safe test' })
          .first()
          .click()
        await send(page, 'OK')
        await page.getByText('OK', { exact: true }).first().waitFor()
        release()
        release = () => {}
        const notice = page.getByRole('status').filter({
          hasText:
            'Not run: a new message cancelled this approval. Ask again if you still want it.',
        })

        await notice.waitFor({ state: 'visible' })
        await until('the fixture to cancel instead of approve', async () => {
          const events = readFileSync(stack.acpLog, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .filter((event) => event.marker === 'E2E_DELIVERY:approval-feedback')

          must(
            !events.some((event) => event.event === 'permission-allow'),
            'ordinary OK not to approve the command',
          )

          return events.some((event) => event.event === 'permission-cancelled')
        })
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/approval-feedback-sent-light.png` })
        // Reload also reads the reason from the durable transcript, not only the live stream.
        await page.reload()
        await notice.waitFor({ state: 'visible' })
        await page
          .locator('[data-sidebar-row]')
          .filter({ hasText: 'Run a safe test' })
          .first()
          .waitFor({ state: 'visible' })
        await page.waitForTimeout(300)
        await page.screenshot({ path: `${artifacts}/approval-feedback-folded-light.png` })
        await send(page, 'Run the command again. E2E_PERMISSION E2E_DELIVERY:approval-again')
        const approve = page.getByRole('button', { name: 'Approve once', exact: true }).last()

        await approve.waitFor({ state: 'visible' })
        await page.screenshot({ path: `${artifacts}/approval-feedback-again-light.png` })
        await page.getByRole('button', { name: 'Deny', exact: true }).last().click()
      } finally {
        release()
      }
    },
  },
]
