import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { agentEvents } from './agent-log.ts'
import { client } from './binding-access-scenarios.ts'
import { loadingFree } from './channel-helpers.ts'
import { VERIFICATION_HOLD } from './fixture-turn-refusals.mjs'
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
      await page.getByRole('textbox', { name: 'Bot name' }).fill('Release Helper')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByText('Which marker should the fixture use?', { exact: true }).waitFor()
      const bot = (await list()).conversations[0]!

      assert.equal(bot.botOnboarding, 'active')
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
      // #3339: an answer given in this chat and a post in it are both this chat's work,
      // so the title-bar pill never says the Bot works elsewhere while it does them.
      const neverElsewhere = async () => {
        for (let i = 0; i < 16; i++) {
          if ((await page.getByText('Working outside this chat').count()) > 0)
            throw new Error("The Bot's chat pill says it works outside the chat it answers")
          await page.waitForTimeout(250)
        }
      }

      await page.getByRole('button', { name: 'E2E_DELIVERY:answered', exact: true }).click()
      await neverElsewhere()
      await until('the setup answer to reach the Bot', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
      )
      // A Bot still in setup that is working shows its work dots, and its setup again at rest.
      const row = page.locator('[data-sidebar-row]').filter({ hasText: 'Release Helper' }).first()

      // The row learns a turn ended from its 4 s poll: until then its dots are the last turn's.
      await row.getByText('Getting started', { exact: true }).waitFor()
      await send(page, 'Still setting up E2E_SLOW E2E_DELIVERY:setup-busy')
      await row.locator('.t-typing-dot').first().waitFor()
      assert.equal(await row.getByText('Getting started', { exact: true }).count(), 0)
      await loadingFree(row, 'While the Bot in setup works')
      await page.screenshot({ path: `${artifacts}/onboarding-working-light.png` })
      await neverElsewhere()
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
      await page.getByText('Getting started', { exact: true }).first().waitFor({ state: 'hidden' })
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
  {
    name: 'a Bot whose Claude account Anthropic holds for verification says where to verify it',
    run: async (page, stack) => {
      const hold = join(dirname(stack.acpLog), 'verification-hold')
      const portal = /https:\S+/u.exec(VERIFICATION_HOLD)![0]

      writeFileSync(hold, '')
      try {
        await page.getByRole('button', { name: 'New Bot', exact: true }).click()
        await page.getByRole('textbox', { name: 'Bot name' }).fill('Verify Helper')
        await page.getByRole('button', { name: 'Create', exact: true }).click()
        const line = page.getByText(
          /couldn’t reply: its .*account must be verified with Anthropic/u,
        )

        await line.waitFor()
        assert.equal(await line.getByRole('link', { name: portal }).getAttribute('href'), portal)
        await page.getByRole('button', { name: 'Switch runtime', exact: true }).waitFor()
        await page.screenshot({ path: `${artifacts}/onboarding-verification-light.png` })
      } finally {
        rmSync(hold, { force: true })
      }
    },
  },
]
