// #4356: a quoted post with a Markdown link reads as the link's label, and a long URL stays
// inside the quote box, in your own bubble and a teammate's, at a narrow and a normal width.
import { agentLog } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { nameViewer, openBotChat, store } from '../channel-quotes.ts'
import { artifacts, until } from '../processes.ts'

import type { Scenario } from '../ui.ts'

const LINKED =
  "Handed off to [Rin's Task](https://example.com/teams/a1b2c3d4e5f6a7b8c9d0e1f2/agent/0f3c9e7a-1b2c-4d5e-8f90-123456789abc), it will report back here."
const LABEL = "Handed off to Rin's Task, it will report back here."

const scenario: Scenario = {
  name: 'a quoted Markdown link reads as its label and stays inside the quote, on both sides',
  run: async (page, stack) => {
    const as = client(stack.apiUrl, stack.token)
    const me = (await as('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
    const viewerId = me.user?.id ?? me.id ?? ''
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('The Bot has not answered in its chat yet')
    await nameViewer(stack, 'Alex Rivera')
    const replyTo = { id: 'e2e-link-post', authorName: 'Mei Chen', text: LINKED }
    const post = (id: string, sender: object, text: string, quote?: object) =>
      store(
        stack,
        channelId,
        id,
        { version: 1, source: 'nuphos', sender, ...(quote ? { replyTo: quote } : {}) },
        text,
      )

    post('e2e-link-post', { type: 'user', id: 'e2e-mei', displayName: 'Mei Chen' }, LINKED)
    post(
      'e2e-link-theirs',
      { type: 'user', id: 'e2e-sam', displayName: 'Sam Okafor' },
      'Thanks, I will follow that Task.',
      replyTo,
    )
    post(
      'e2e-link-mine',
      { type: 'user', id: viewerId, displayName: 'Alex Rivera' },
      'Great, ping me when it lands.',
      replyTo,
    )
    // Stored behind the app's back: a reload reads them as a later visit would.
    await page.reload()
    await openBotChat(page)
    await page
      .getByText('Great, ping me when it lands.')
      .filter({ visible: true })
      .first()
      .waitFor()

    const themed = await page.evaluate(() => document.documentElement.className)
    // Window widths by emulation, cleared after: the scenarios after this one see the window as it was.
    const cdp = await page.context().newCDPSession(page)

    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    })
    const problems: string[] = []

    try {
      for (const [name, width] of [
        ['narrow', 720],
        ['normal', 1280],
      ] as const) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 800,
          deviceScaleFactor: 0,
          mobile: false,
        })
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${artifacts}/link-quote-${name}-light.png` })
        for (const id of ['e2e-link-mine', 'e2e-link-theirs']) {
          const quote = page
            .locator(`[data-post-id="${id}"] button`)
            .filter({ hasText: 'Mei Chen' })
          const seen = await quote.evaluate((box) => {
            const bubble = box.parentElement!.getBoundingClientRect()
            const own = box.getBoundingClientRect()

            return {
              text: box.textContent ?? '',
              spill: own.right - bubble.right,
              hidden: box.scrollWidth - box.clientWidth,
            }
          })

          // Recorded, not thrown: both widths are captured either way.
          if (!seen.text.includes(LABEL))
            problems.push(`${name} ${id}: the quote reads ${JSON.stringify(seen.text)}`)
          if (seen.spill > 1 || seen.hidden > 1)
            problems.push(`${name} ${id}: the quote runs out of its box ${JSON.stringify(seen)}`)
        }
      }
      if (problems.length > 0) throw new Error(problems.join('\n'))
      // Clicking the quote still goes to the quoted post.
      const quoted = page.locator('[data-post-id="e2e-link-post"]')

      await page
        .locator('[data-post-id="e2e-link-mine"] button')
        .filter({ hasText: 'Mei Chen' })
        .click()
      await until('the quoted post to flash', () =>
        quoted.evaluate((node) => node.classList.contains('cell-flash')),
      )
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await cdp.detach()
      await page.evaluate((themed) => {
        document.documentElement.className = themed
      }, themed)
      await nameViewer(stack)
    }
  },
}

export default scenario
