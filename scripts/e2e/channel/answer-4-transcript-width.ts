// #4358: no post moves the Bot chat sideways. Long runs with no break point, a URL, a wide
// table, long code and quotes of a long run stay inside the transcript's width at a narrow and
// a normal window; only the table scrolls sideways, inside its own box.
import { agentLog } from '../agent-log.ts'
import { client } from '../binding-access-scenarios.ts'
import { nameViewer, openBotChat, store } from '../channel-quotes.ts'
import { artifacts } from '../processes.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Locator } from 'playwright-core'

const RUN = 'a1b2c3d4e5f6'.repeat(30)
const ADDRESS = `https://example.com/teams/a1b2c3d4e5f6a7b8c9d0e1f2/agent/${RUN}`
const row = (word: string) =>
  ['', ...Array.from({ length: 14 }, (_, i) => `${word}_${String(i)}`), ''].join(' | ').trim()
const TABLE = [row('Column_header'), `|${' --- |'.repeat(14)}`, row('value_long_cell')].join('\n')
const CODE = `kubectl get pods -o wide ${'--selector=app.kubernetes.io/name=example '.repeat(8)}`

function storePosts(stack: Stack, channelId: string, viewerId: string) {
  const mei = { type: 'user', id: 'e2e-mei', displayName: 'Mei Chen' }
  const mine = { type: 'user', id: viewerId, displayName: 'Alex Rivera' }
  const post = (id: string, sender: object, text: string, replyTo?: object) =>
    store(
      stack,
      channelId,
      id,
      { version: 1, source: 'nuphos', sender, ...(replyTo ? { replyTo } : {}) },
      text,
    )

  post('e2e-wide-table', mei, `The rollout table:\n\n${TABLE}`)
  post('e2e-wide-code', mine, `Run this:\n\n\`\`\`sh\n${CODE}\n\`\`\``)
  post('e2e-wide-run', mei, `Build id ${RUN}`)
  post('e2e-wide-url', mine, `See ${ADDRESS}`)
  post(
    'e2e-wide-quote-theirs',
    { type: 'user', id: 'e2e-sam', displayName: 'Sam Okafor' },
    'That is the one I saw.',
    { id: 'e2e-wide-url', authorName: 'Alex Rivera', text: `See ${ADDRESS}` },
  )
  post('e2e-wide-quote-mine', mine, 'Thanks, that is the build.', {
    id: 'e2e-wide-run',
    authorName: 'Mei Chen',
    text: `Build id ${RUN}`,
  })
}

/** How the transcript holding `post` scrolls: sideways (it should not) and up (it should),
 *  and whether the wide table scrolls sideways in its own box. */
function measure(post: Locator) {
  return post.evaluate((node) => {
    const scrolls = (element: Element, axis: 'overflowX' | 'overflowY') =>
      /(auto|scroll)/.test(getComputedStyle(element)[axis])
    let scroller = node.parentElement

    while (scroller && !scrolls(scroller, 'overflowY')) scroller = scroller.parentElement
    let frame = document.querySelector('[data-post-id="e2e-wide-table"] table')?.parentElement

    while (frame && !scrolls(frame, 'overflowX')) frame = frame.parentElement
    if (!scroller || !frame) return null
    const swiped = scroller.scrollLeft

    scroller.scrollLeft = 400
    const set = scroller.scrollLeft

    scroller.scrollLeft = 0
    frame.scrollLeft = 200
    const tableScroll = frame.scrollLeft

    frame.scrollLeft = 0
    const top = scroller.scrollTop

    scroller.scrollTop = 0
    const scrolledUp = scroller.scrollTop !== top

    scroller.scrollTop = top

    return {
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      swiped,
      set,
      tableScroll,
      scrolledUp,
    }
  })
}

const scenario: Scenario = {
  name: 'no post scrolls the whole Bot chat sideways; a wide table scrolls in its own box',
  run: async (page, stack) => {
    const as = client(stack.apiUrl, stack.token)
    const me = (await as('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
    const channelId = agentLog(stack).find((entry) => entry.event === 'channel')?.detail

    if (!channelId) throw new Error('The Bot has not answered in its chat yet')
    await nameViewer(stack, 'Alex Rivera')
    storePosts(stack, channelId, me.user?.id ?? me.id ?? '')
    await page.reload()
    await openBotChat(page)
    const last = page.locator('[data-post-id="e2e-wide-quote-mine"]')

    await last.waitFor()
    const themed = await page.evaluate(() => document.documentElement.className)
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
        await last.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${artifacts}/transcript-width-${name}-light.png` })
        // A trackpad swipe sideways over the transcript.
        await last.hover()
        await page.mouse.wheel(400, 0)
        await page.waitForTimeout(300)
        const seen = await measure(last)

        if (!seen) throw new Error('No scrolling transcript, or no scrolling box round the table')
        if (seen.scrollWidth - seen.clientWidth > 1 || seen.swiped > 0 || seen.set > 0)
          problems.push(`${name}: the whole transcript moves sideways ${JSON.stringify(seen)}`)
        if (seen.tableScroll === 0) problems.push(`${name}: the table does not scroll in its box`)
        if (!seen.scrolledUp) problems.push(`${name}: the transcript no longer scrolls up`)
      }
      if (problems.length > 0) throw new Error(problems.join('\n'))
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
