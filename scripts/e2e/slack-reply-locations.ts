import { artifacts, until } from './processes.ts'
import { slackPosts } from './slack-stub.ts'

import type { Page } from 'playwright-core'

/** Open the isolated Slack settings and capture a light-theme view. */
export async function shootSettings(page: Page, file: string, bot: string) {
  await page.reload()
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.getByRole('button', { name: 'Connectors', exact: true }).click()
  await page
    .getByRole('button', { name: /^Open Slack/ })
    .first()
    .click()
  const channels = page.getByText('Connected channels').first()

  await channels.waitFor()
  await page.getByText(bot, { exact: true }).first().waitFor()
  await channels.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${artifacts}/${file}` })
}

export async function verifySlackReplyLocations(
  send: (text: string, thread: string) => Promise<unknown>,
  botPosts: () => number,
  root: string,
) {
  const beforeMention = botPosts()

  await send('<@UE2EBOT> Thread mention E2E_REPLY_TO E2E_DELIVERY:slack-thread-mention', root)
  await until('the Bot to answer a thread mention', async () => botPosts() > beforeMention)
  if (slackPosts().at(-1)?.thread_ts !== root)
    throw new Error('The answer to a thread mention did not stay in its thread')
  // A thread can predate the channel connection, so its root may not be in the record.
  const beforeOldThread = botPosts()
  const oldRoot = '1799999999.000100'

  await send('Old thread E2E_REPLY_TO', oldRoot)
  await until(
    'the Bot to answer a thread with an unseen root',
    async () => botPosts() > beforeOldThread,
  )
  if (slackPosts().at(-1)?.thread_ts !== oldRoot)
    throw new Error('The answer to an existing thread did not stay in that thread')
}
