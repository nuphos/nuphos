// A Bot whose agent host goes away while a person posts in its chat (#3260).
import { agentLog } from './agent-log.ts'
import { artifacts } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Locator, Page } from 'playwright-core'

/** Posts `text` in the Bot's chat as the person, as the composer does. */
function poster(stack: Stack) {
  const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

  if (!channelId) throw new Error('The Bot has not answered in its chat yet')

  return async (text: string) => {
    const response = await fetch(
      `${stack.apiUrl}/agent/conversations/${channelId}/channel-messages`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: stack.teamId, text }),
      },
    )

    if (!response.ok) throw new Error(`Posting failed: ${String(response.status)}`)
  }
}

/** Waits up to `ms` for `locator` to show, then pictures the chat either way; whether it showed. */
async function shown(page: Page, locator: Locator, ms: number, shot: string) {
  const showed = await locator.waitFor({ timeout: ms }).then(
    () => true,
    () => false,
  )

  await page.screenshot({ path: `${artifacts}/${shot}` })

  return showed
}

export const channelAwayScenarios: Scenario[] = [
  {
    // #3260: a post while the Bot's agent host was down was lost without a word, and stayed
    // lost once the host was back, until someone posted again.
    name: 'a post while the Bot’s agent host is down says it could not reply, and it answers once back',
    run: async (page, stack) => {
      const post = poster(stack)
      const failed = page.getByText(/couldn’t reply/)
      let line = false

      await page.getByRole('tab', { name: 'Bots' }).click()
      await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
      await page.locator('[data-post-id]').first().waitFor()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      const before = await failed.count()

      await stack.restartAgentHost(async () => {
        await post('While it is away E2E_DELIVERY:away')
        // A reconnecting runtime gets a minute before the post counts as undelivered.
        line = await shown(page, failed.nth(before), 150_000, 'bot-away-line-light.png')
      })
      const answered = await shown(
        page,
        // The Bot's row in the sidebar shows the same post as its preview.
        page.getByText('POSTED E2E_DELIVERY:away', { exact: true }).first(),
        150_000,
        'bot-away-answered-light.png',
      )

      if (!line) throw new Error('Nothing in the chat said the Bot could not reply')
      if (!answered) throw new Error('The Bot did not answer the post once its host was back')
    },
  },
]
