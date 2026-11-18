// The notice a person gets when a teammate shares a computer with them: once, in the app.
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'

import type { Client } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const LABEL = 'Teammate laptop'

/** Signs a teammate in and has them accept an invitation to the stack's team. */
async function teammate(stack: Stack, owner: Client): Promise<{ as: Client; token: string }> {
  const email = `e2e-sharer-${String(Date.now())}@example.com`
  const anonymous = client(stack.apiUrl, '')

  await anonymous('POST', '/auth/email/request-code', { email })
  await until('the teammate sign-in code to be logged', async () => stack.signInCode(email))
  const verified = await anonymous('POST', '/auth/email/verify-code', {
    email,
    code: stack.signInCode(email),
  })
  const token = (verified.body as { token: string }).token
  const as = client(stack.apiUrl, token)
  const invited = await owner('POST', `/teams/${stack.teamId}/invitations`, { inviteeEmail: email })
  const invitationId = (invited.body as { invitation: { id: string } }).invitation.id

  must(
    (await as('POST', `/invitations/${invitationId}/accept`)).status === 200,
    'the teammate to accept the invitation',
  )

  return { as, token }
}

export const shareNoticeScenarios: Scenario[] = [
  {
    name: 'a computer a teammate shares with you is announced once, in the app',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
      const sharer = await teammate(stack, owner)
      // Their own computer: registered with their sign-in, so they own it.
      const computer = await startSecondComputer({ ...stack, token: sharer.token }, LABEL)
      const share = `/agent/devices/${computer.deviceId}/share?teamId=${stack.teamId}`
      const notice = page.getByText(`${LABEL} is now shared with you`, { exact: true })
      // The sidebar reads the computers again when the window shows again, as it does each minute.
      const look = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

      try {
        // Seen before it is shared, so only the share is news.
        await look()
        const shared = await sharer.as('PUT', share, {
          level: 'full',
          everyone: false,
          userIds: [me.user?.id ?? me.id ?? ''],
        })

        must(shared.status === 200, `the computer to be shared, got ${String(shared.status)}`)
        await look()
        await notice.first().waitFor()
        const shown = await notice.count()

        await page.screenshot({ path: `${artifacts}/computer-shared-toast.png` })
        // Another look finds nothing new: still the one notice.
        await look()
        await page.waitForTimeout(3000)
        must((await notice.count()) === shown, 'the share to be announced only once')
      } finally {
        await sharer.as('PUT', share, { level: 'off', everyone: false, userIds: [] })
        await computer.stop()
      }
    },
  },
]
