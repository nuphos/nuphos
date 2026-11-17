// Scenarios about a Bot reading its chat. They run in the Bot chat the scenario before opened.
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

const light = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

/** Waits up to `ms` for `locator` to show, then pictures the chat either way; whether it showed. */
async function shown(page: Page, locator: Locator, ms: number, shot: string) {
  const showed = await locator.waitFor({ timeout: ms }).then(
    () => true,
    () => false,
  )

  await page.screenshot({ path: `${artifacts}/${shot}` })

  return showed
}

export const channelScenarios: Scenario[] = [
  {
    // #2949: channel_read in a woken turn returned the page the notice had shown, not the rest.
    name: 'a Bot woken by more than a page of posts reads on to the newest one',
    run: async (page, stack) => {
      const post = poster(stack)

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
    // #3260: a post while the Bot's agent host was down was lost without a word, and stayed
    // lost once the host was back, until someone posted again.
    name: 'a post while the Bot’s agent host is down says it could not reply, and it answers once back',
    run: async (page, stack) => {
      const post = poster(stack)
      const failed = page.getByText(/couldn’t reply/)
      const before = await failed.count()
      let line = false

      await light(page)
      await stack.restartAgentHost(async () => {
        await post('While it is away E2E_DELIVERY:away')
        // A reconnecting runtime gets a minute before the post counts as undelivered.
        line = await shown(page, failed.nth(before), 150_000, 'bot-away-line-light.png')
      })
      const answered = await shown(
        page,
        page.getByText('POSTED E2E_DELIVERY:away', { exact: true }),
        150_000,
        'bot-away-answered-light.png',
      )

      if (!line) throw new Error('Nothing in the chat said the Bot could not reply')
      if (!answered) throw new Error('The Bot did not answer the post once its host was back')
    },
  },
  {
    // #3246: every Bot post was headed by the Bot's name and an "Agent" tag.
    name: "a Bot's posts are headed by its name, with no Agent tag",
    run: async (page) => {
      const posts = page.locator('[data-post-id]')

      await posts.first().waitFor()
      await light(page)
      await page.screenshot({ path: `${artifacts}/bot-post-header-light.png` })
      const tags = await posts.getByText('Agent', { exact: true }).count()

      if (tags > 0) throw new Error(`${String(tags)} Bot posts carry an Agent tag`)
    },
  },
]
