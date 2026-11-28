// The E2E Bot and the chain of scenarios in its chat, which CI runs as a part of its own.
import { agentEvents } from './agent-log.ts'
import { botUnreadScenarios } from './bot-unread-scenarios.ts'
import { botWorkingDotsScenarios } from './bot-working-dots-scenarios.ts'
import { channelAwayScenarios } from './channel-away-scenarios.ts'
import { channelRestartScenarios } from './channel-restart-scenarios.ts'
import { channelScenarios } from './channel-scenarios.ts'
import { checkDecisionOutline, checkOutgoingChip } from './chat-presentation.ts'
import { artifacts, until } from './processes.ts'
import { replyDiskScenario } from './reply-disk-scenario.ts'
import { send, transcriptPost } from './ui.ts'

import type { Scenario } from './ui.ts'

// The flow #2412 was reported in: a Bot's credential question with choices, answered in its chat.
// Later scenarios in both the first part and the Bot chats need this Bot.
export const createBotScenario: Scenario = {
  name: 'create a Bot, talk to it in its chat, and answer its question there',
  run: async (page, stack) => {
    await page.getByRole('button', { name: 'New Bot', exact: true }).click()
    await page.getByRole('textbox', { name: 'Bot name' }).fill('E2E Bot')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    // No user prompt precedes this reply: creating/opening the Bot starts its introduction.
    // The fixture's missing marker proves the turn did not originate from a delivery prompt.
    await transcriptPost(page, 'POSTED E2E_DELIVERY:missing').waitFor()
    await until('the unprompted Bot introduction to finish', async () =>
      agentEvents(stack).includes('finish E2E_DELIVERY:missing'),
    )
    await page.screenshot({ path: `${artifacts}/bot-first-reply.png` })
    await send(
      page,
      'Review https://github.com/nuphos/nuphos/issues/1 E2E_ASK_CREDENTIAL E2E_DELIVERY:bot',
    )
    await transcriptPost(page, 'POSTED E2E_DELIVERY:bot').waitFor()
    await checkDecisionOutline(page)
    await checkOutgoingChip(page)
    await page.screenshot({ path: `${artifacts}/bot-question-outline.png` })
    await page.getByRole('button', { name: 'E2E_DELIVERY:answered' }).click()
    await until('the answer in the Bot chat to reach the Bot', async () =>
      agentEvents(stack).includes('finish E2E_DELIVERY:answered'),
    )
  },
}

// Part 1 skips the Bot chats, one of which ends the Bot's setup; its later Bot scenarios need
// an established Bot.
export const finishBotSetupScenario: Scenario = {
  name: "finish the Bot's setup in its chat",
  run: async (page, stack) => {
    await send(page, 'Confirmed: review releases. E2E_ONBOARDING_COMPLETE E2E_DELIVERY:bot-setup')
    await until('the Bot setup turn to finish', async () =>
      agentEvents(stack).includes('finish E2E_DELIVERY:bot-setup'),
    )
    await page
      .locator('[data-sidebar-row]')
      .filter({ hasText: 'E2E Bot' })
      .first()
      .getByText('Getting started', { exact: true })
      .waitFor({ state: 'hidden' })
  },
}

// One run of scenarios in the chat of the Bot created above, each picking up where the one
// before left it. CI runs them on a runner of their own (E2E_SHARD=bots).
export const botChatScenarios: Scenario[] = [
  { name: 'a reply and low disk warning remain visible together', run: replyDiskScenario },
  ...botUnreadScenarios,
  ...channelScenarios,
  ...botWorkingDotsScenarios,
  ...channelAwayScenarios,
  ...channelRestartScenarios,
]
