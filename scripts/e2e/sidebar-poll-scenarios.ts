// #4710: the sidebar's poll lists only each listing's first page, yet still shows what changed.
import { writeFileSync } from 'node:fs'

import { backendLines, backendLog } from './backend-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'

// Five pages of group chats in one listing: a poll that read every page would ask eight times.
const CHATS = 450
// A minute, so the count is the rate per minute.
const WINDOW_MS = 60_000

export const sidebarPollScenarios: Scenario[] = [
  {
    name: 'the sidebar poll reads first pages only and still shows new, active and archived chats',
    run: async (page, stack) => {
      const api = client(stack.apiUrl, stack.token)
      const made: string[] = []
      const group = async (title: string) => {
        const reply = await api('POST', '/agent/channels', {
          teamId: stack.teamId,
          title,
          group: true,
        })

        must(reply.status < 300, `${title} to be made, got ${reply.text}`)
        const { sessionId } = reply.body as { sessionId: string }

        made.push(sessionId)

        return sessionId
      }
      const rows = page.locator('[data-sidebar-row]')
      const row = (title: string) => rows.filter({ hasText: title })
      const firstRow = async () => (await rows.first().textContent()) ?? ''

      for (let n = 1; n <= CHATS; n++) await group(`Poll chat ${String(n).padStart(3, '0')}`)
      const oldest = made[0]!

      await page.reload()
      await page.getByRole('tab', { name: 'Bots' }).click()
      await row(`Poll chat ${String(CHATS)}`)
        .first()
        .waitFor()

      // Idle, so the window holds the polls and little else.
      const from = backendLines()

      await page.waitForTimeout(WINDOW_MS)
      // Each poll is a burst of listing requests a few hundred milliseconds apart.
      const times = backendLog(from)
        .filter((line) => /"method":"GET","path":"\/agent\/conversations"/.test(line))
        .map((line) => Date.parse((JSON.parse(line) as { ts: string }).ts))
      const bursts: number[] = []

      times.forEach((time, index) => {
        if (index === 0 || time - times[index - 1]! > 1_000) bursts.push(0)
        bursts[bursts.length - 1]!++
      })
      writeFileSync(
        `${artifacts}/sidebar-poll.json`,
        JSON.stringify({ chats: CHATS, windowMs: WINDOW_MS, listRequests: times.length, bursts }),
      )
      // Four listings, one page each, and room for other queries' reads beside them; reading
      // every page is eight.
      must(Math.max(...bursts) < 8, `a poll to read first pages only, got bursts ${bursts.join()}`)

      // A chat from the last page that gets a post comes to the top.
      must(!(await firstRow()).includes('Poll chat 001'), 'the oldest chat not to be first yet')
      const posted = await api('POST', `/agent/conversations/${oldest}/channel-messages`, {
        teamId: stack.teamId,
        text: 'Poll chat 001 is active again',
      })

      must(posted.status < 300, `the post to be sent, got ${posted.text}`)
      await until('the active chat to come to the top', async () =>
        (await firstRow()).includes('Poll chat 001'),
      )

      // A chat made elsewhere shows up.
      await group('Poll chat new')
      await row('Poll chat new').first().waitFor()

      // A chat archived elsewhere leaves.
      const archived = await api('PATCH', `/agent/conversations/${made.at(-1)!}/archive`, {
        teamId: stack.teamId,
        archived: true,
      })

      must(archived.status < 300, `the archive to be done, got ${archived.text}`)
      await row('Poll chat new').first().waitFor({ state: 'detached' })
      await page.screenshot({ path: `${artifacts}/sidebar-poll.png` })

      // Leaves the sidebar as it found it.
      for (const sessionId of made.slice(0, -1))
        await api('PATCH', `/agent/conversations/${sessionId}/archive`, {
          teamId: stack.teamId,
          archived: true,
        })
    },
  },
]
