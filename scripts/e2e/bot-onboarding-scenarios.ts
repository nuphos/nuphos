import assert from 'node:assert/strict'

import { agentEvents } from './agent-log.ts'
import { client } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Row = {
  sessionId: string
  botOnboarding?: string
  instructions?: string
  inputRequests?: { id: string; category: string }[]
}

export const botOnboardingScenarios: Scenario[] = [
  {
    name: 'initial Bot setup stays in chat across reload and normal work questions enter the Inbox after completion',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const list = async (pending = false) =>
        (
          await api(
            'GET',
            `/agent/conversations?teamId=${stack.teamId}&bots=true${pending ? '&pendingDecision=true' : ''}`,
          )
        ).body as { conversations: Row[] }

      await page.getByRole('button', { name: 'New Bot', exact: true }).click()
      await page.getByRole('textbox', { name: 'Agent name' }).fill('Release Helper')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByText('Which marker should the fixture use?', { exact: true }).waitFor()
      const bot = (await list()).conversations[0]!

      assert.equal(bot.botOnboarding, 'started')
      assert.equal(bot.inputRequests?.length, 1)
      assert.equal((await list(true)).conversations.length, 0)
      await page.getByText('Getting started', { exact: true }).first().waitFor()
      assert.equal(await page.getByText(/^Needs your input/).count(), 0)
      await page.screenshot({ path: `${artifacts}/onboarding-chat.png` })
      await page.getByRole('tab', { name: 'Inbox', exact: true }).click()
      await page
        .getByText('Which marker should the fixture use?', { exact: true })
        .waitFor({ state: 'hidden' })
      await page.screenshot({ path: `${artifacts}/onboarding-inbox-empty.png` })
      await page.getByRole('tab', { name: /^Bots/ }).click()
      await page.getByText('Release Helper', { exact: true }).first().click()
      await page.reload()
      await page.getByText('Which marker should the fixture use?', { exact: true }).waitFor()
      const resumed = (await list()).conversations.find((row) => row.sessionId === bot.sessionId)!

      assert.equal(resumed.inputRequests?.[0]?.id, bot.inputRequests?.[0]?.id)
      assert.equal(
        agentEvents(stack).filter((event) => event === 'finish E2E_DELIVERY:missing').length,
        1,
      )
      await page.screenshot({ path: `${artifacts}/onboarding-resumed.png` })
      await page.getByRole('button', { name: 'E2E_DELIVERY:answered', exact: true }).click()
      await until('the setup answer to reach the Bot', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
      )
      // A Bot still in setup that is working shows its work dots, and its setup again at rest.
      const row = page.locator('[data-sidebar-row]').filter({ hasText: 'Release Helper' }).first()

      await send(page, 'Still setting up E2E_SLOW E2E_DELIVERY:setup-busy')
      await row.locator('.t-typing-dot').first().waitFor()
      assert.equal(await row.getByText('Getting started', { exact: true }).count(), 0)
      await page.screenshot({ path: `${artifacts}/onboarding-working-light.png` })
      await until('the setup-time turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:setup-busy'),
      )
      await row.getByText('Getting started', { exact: true }).waitFor()
      await page.screenshot({ path: `${artifacts}/onboarding-at-rest-light.png` })
      await send(
        page,
        'Confirmed: review project releases and prepare a weekly summary. E2E_ONBOARDING_COMPLETE',
      )
      await until(
        'onboarding to persist completion',
        async () =>
          (await list()).conversations.find((row) => row.sessionId === bot.sessionId)
            ?.botOnboarding === 'completed',
      )
      await page.screenshot({ path: `${artifacts}/onboarding-completed.png` })
      await send(page, 'Ask a normal work question E2E_ASK E2E_DELIVERY:normal')
      await until('the normal question to reach the Inbox', async () =>
        (await list(true)).conversations.some((row) => row.sessionId === bot.sessionId),
      )
      await page.getByRole('tab', { name: 'Inbox', exact: true }).click()
      await page
        .getByText('Which marker should the fixture use?', { exact: true })
        .first()
        .waitFor()
      await page.screenshot({ path: `${artifacts}/normal-work-inbox.png` })
    },
  },
]
