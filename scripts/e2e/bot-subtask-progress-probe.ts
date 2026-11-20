// Probe for #4227, not a check: what a Bot's chat shows while one sub-Task works, read from the
// visible chat, and whether a teammate who doesn't own the Bot can list that sub-Task at all.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

type Row = { sessionId: string; title?: string; parentSessionId?: string; avatar?: string }

export const botSubtaskProgressProbe: Scenario[] = [
  {
    name: 'PROBE #4227: the Bot chat while one sub-Task works, and a teammate’s lists',
    run: async (page, stack) => {
      const call = async (token: string, method: string, path: string, body?: object) => {
        const response = await fetch(`${stack.apiUrl}${path}`, {
          method,
          headers: {
            ...(token && { authorization: `Bearer ${token}` }),
            'content-type': 'application/json',
          },
          body: body && JSON.stringify(body),
        })

        return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> }
      }
      const list = async (token: string, query: string) =>
        ((await call(token, 'GET', `/agent/conversations?teamId=${stack.teamId}&limit=30&sort=activity&archived=exclude&${query}`)).body
          .conversations ?? []) as Row[]
      const bots = page.getByRole('tabpanel', { name: 'Bots' })
      const bot = bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first()
      const release = join(artifacts, 'release')
      // The visible chat's own header, not the first titlebar in the DOM.
      const header = page.locator('.workspace-agent-titlebar:visible').filter({ hasText: 'E2E Bot' }).first()
      const look = async (when: string) => {
        const text = (await header.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const waiting = await page.getByText(/Waiting on \d+ Tasks?/).first().isVisible().catch(() => false)
        const kid = await bots.locator('[data-sidebar-row]').filter({ hasText: 'E2E unlisted kid' }).count()

        console.log(`PROBE ${when} | header: ${JSON.stringify(text)} | waiting-pill: ${String(waiting)} | kid-rows: ${String(kid)}`)
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: `${artifacts}/probe4227-${when}-light.png` })
      }

      await page.getByRole('tab', { name: 'Bots' }).click()
      await bot.click()
      rmSync(release, { force: true })
      try {
        await look('before')
        await send(page, 'Hand this off E2E_SUBTASK E2E_DELIVERY:unlisted-probe-4227')
        for (const seconds of [3, 8, 15]) {
          await page.waitForTimeout(seconds * 1000)
          await look(`held-${String(seconds)}s`)
        }

        // A teammate who doesn't own the Bot, while the same sub-Task is still held.
        const email = `e2e-4227-${String(Date.now())}@example.com`

        await call('', 'POST', '/auth/email/request-code', { email })
        await until('the teammate’s sign-in code', async () => stack.signInCode(email))
        const teammate = String(
          (await call('', 'POST', '/auth/email/verify-code', { email, code: stack.signInCode(email) })).body.token,
        )
        const invited = await call(stack.token, 'POST', `/teams/${stack.teamId}/invitations`, { inviteeEmail: email })
        const invitation = (invited.body.invitation as { id?: string } | undefined)?.id
        const accepted = await call(teammate, 'POST', `/invitations/${String(invitation)}/accept`)

        console.log(`PROBE teammate | invited ${String(invited.status)} | accepted ${String(accepted.status)}`)
        const ownerMine = await list(stack.token, 'scope=mine')
        const botRow = (await list(stack.token, 'scope=mine&bots=true')).find((row) => row.title === 'E2E Bot')
        const members = ((await call(stack.token, 'GET', `/teams/${stack.teamId}/members`)).body.members ?? []) as {
          id: string
          email: string
        }[]
        const teammateId = String(members.find((m) => m.email === email)?.id)
        const chats = ((await call(stack.token, 'GET', `/agent/conversations?teamId=${stack.teamId}&kind=channel&limit=30`)).body
          .conversations ?? []) as (Row & { botId?: string })[]
        const botChat = chats.find((row) => row.botId === botRow?.sessionId)

        // The teammate joins the Bot's chat and the Bot itself, as someone the owner shared it with.
        for (const id of [botChat?.sessionId, botRow?.sessionId]) {
          const joined = await call(stack.token, 'POST', `/agent/conversations/${String(id)}/participants?teamId=${stack.teamId}`, {
            userIds: [teammateId],
          })

          console.log(`PROBE teammate joins ${String(id)} | ${String(joined.status)} ${JSON.stringify(joined.body).slice(0, 120)}`)
        }
        const kids = (rows: Row[]) => rows.filter((row) => row.parentSessionId === botRow?.sessionId).map((row) => row.title)

        for (const [who, token] of [['owner', stack.token], ['teammate', teammate]] as const)
          for (const scope of ['mine', 'team', 'shared']) {
            const rows = await list(token, `scope=${scope}`)
            const sees = rows.some((row) => row.sessionId === botRow?.sessionId)

            console.log(`PROBE list ${who} scope=${scope} | rows: ${String(rows.length)} | bot listed: ${String(sees)} | kids: ${JSON.stringify(kids(rows))}`)
          }
        console.log(`PROBE owner mine kids sanity: ${JSON.stringify(kids(ownerMine))}`)
      } finally {
        writeFileSync(release, '')
      }
      await page.waitForTimeout(10_000)
      await look('after')
      rmSync(release, { force: true })
    },
  },
]
