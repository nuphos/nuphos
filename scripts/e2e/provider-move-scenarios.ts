// #3709: a Task that moves to another provider and back keeps a named model and effort.
import { agentLog } from './agent-log.ts'
import { artifacts } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Stack } from './stack.ts'
import type { Page } from 'playwright-core'

const chip = (page: Page) => page.getByRole('button', { name: /^Model settings/ })

/** Waits until the chip names a model and an effort level, captures it, and returns its label. */
async function namedSettings(page: Page, shot: string, level: RegExp) {
  const label = new RegExp(`^Model settings: .+ ${level.source}`)

  await page.getByRole('button', { name: label }).waitFor({ timeout: 20_000 })
  await chip(page).click()
  await page.getByRole('slider').waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${artifacts}/${shot}-light.png` })
  await page.keyboard.press('Escape')

  return (await chip(page).getAttribute('aria-label')) ?? ''
}

/** The settings the session that ran `marker` was opened with, on `agent`. */
function sessionDefaults(stack: Stack, agent: string, marker: string) {
  const log = agentLog(stack)
  const turn = log.find((entry) => entry.event === 'finish' && entry.marker === marker)
  const session = log.find(
    (entry) => entry.event === 'session' && entry.sessionId === turn?.sessionId,
  )

  if (session?.agent !== agent)
    throw new Error(`${marker} did not run on ${agent}: ${JSON.stringify(session)}`)

  return session.defaults ?? {}
}

export const providerMoveScenarios: Scenario[] = [
  {
    name: 'a Task moved to Codex and back names its model and effort, and its sessions start on them',
    run: async (page, stack) => {
      const stopOffering = stack.offerDefaultStandIn()
      const theme = await page.evaluate(() => {
        const previous = document.documentElement.className

        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')

        return previous
      })

      try {
        await newTask(page)
        await pickAgent(page, 'E2E fixture agent')
        await send(page, 'On Claude Code E2E_DELIVERY:provider-start')
        await page.getByText('ACK E2E_DELIVERY:provider-start').waitFor()

        // Claude Code → Codex: the Codex agent's own effort, named, never a blank "Default".
        await pickAgent(page, 'E2E Codex agent', 'Codex')
        await page.getByText('moved this task from E2E fixture agent to E2E Codex agent').waitFor()
        await namedSettings(page, 'provider-move-codex', /Low/)
        // A model picked there is saved with that effort, not alone.
        await chip(page).click()
        await page.getByRole('menuitemcheckbox', { name: /^fixture-small/ }).click()
        await namedSettings(page, 'provider-move-codex-picked', /Low/)
        await send(page, 'On Codex E2E_DELIVERY:provider-codex')
        await page.getByText('ACK E2E_DELIVERY:provider-codex').waitFor()
        const onCodex = sessionDefaults(stack, 'codex', 'E2E_DELIVERY:provider-codex')

        if (onCodex.model !== 'fixture-small' || onCodex.effort !== 'low')
          throw new Error(
            `The Codex session did not start on its picks: ${JSON.stringify(onCodex)}`,
          )

        // Codex → Claude Code: Claude Code's effort, named, and stored for its next session.
        await pickAgent(page, 'E2E fixture agent')
        await page.getByText('moved this task from E2E Codex agent to E2E fixture agent').waitFor()
        await namedSettings(page, 'provider-move-back', /Low/)
        await send(page, 'Back on Claude Code E2E_DELIVERY:provider-back')
        await page.getByText('ACK E2E_DELIVERY:provider-back').waitFor()
        const back = sessionDefaults(stack, 'first', 'E2E_DELIVERY:provider-back')

        if (!back.effort)
          throw new Error(`The session after moving back has no effort: ${JSON.stringify(back)}`)
      } finally {
        stopOffering()
        await page.evaluate((previous) => {
          document.documentElement.className = previous
        }, theme)
      }
    },
  },
]
