// Computers a teammate shares with you: the notice, once, in the app, and how their cards read.
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openComputers } from './ui.ts'

import type { Client } from './binding-access-scenarios.ts'
import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'Teammate laptop'
const SAME_MAC = "Teammate's record of this Mac"

type Listed = { label: string; metricsStatus?: string; metrics?: unknown }

/** The computers as the app lists them on its Computers page, readings included. */
const listed = (page: Page, teamId: string) =>
  page.evaluate(
    async (team) =>
      (
        await (
          window as unknown as {
            api: {
              boxListDevices: (options: object) => Promise<{ devices: Listed[] }>
            }
          }
        ).api.boxListDevices({ metrics: true, teamId: team })
      ).devices,
    teamId,
  )

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
  {
    // #3771: this computer's own reading went, as live, onto every record of its device id.
    name: "another account's record of this computer shows no readings of its own",
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
      let deviceId = ''

      await until('the app to be online as its computer', async () => {
        const state = await page.evaluate(() =>
          (
            window as unknown as {
              api: {
                localRuntimeGetState: () => Promise<{ deviceId?: string; connection?: string }>
              }
            }
          ).api
            .localRuntimeGetState()
            .catch(() => null),
        )

        deviceId = state?.connection === 'online' ? (state.deviceId ?? '') : ''

        return deviceId
      })
      const sharer = await teammate(stack, owner)
      // The same machine as another account registers it: one hardware id, two records.
      const registered = await sharer.as('PUT', '/agent/devices', {
        deviceId,
        label: SAME_MAC,
        platform: 'darwin',
        allowLocalExec: true,
      })

      must(registered.status === 200, `the record to be made, got ${String(registered.status)}`)
      const share = `/agent/devices/${deviceId}/share?teamId=${stack.teamId}`

      try {
        must(
          (
            await sharer.as('PUT', share, {
              level: 'full',
              everyone: false,
              userIds: [me.user?.id ?? me.id ?? ''],
            })
          ).status === 200,
          'the record to be shared',
        )
        await openComputers(page)
        await page.getByText(SAME_MAC, { exact: true }).filter({ visible: true }).first().waitFor()
        // This computer's own card shows what its host reports, once it has reported.
        await until('this computer to report its readings', async () =>
          (await listed(page, stack.teamId)).some(
            (device) => device.label !== SAME_MAC && device.metricsStatus === 'live',
          ),
        )
        // The cards fade in; the picture is taken once they have.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: `${artifacts}/same-computer-two-accounts.png` })
        const theirs = (await listed(page, stack.teamId)).find(
          (device) => device.label === SAME_MAC,
        )

        must(
          theirs?.metricsStatus !== 'live' && !theirs?.metrics,
          `the other account's offline record to carry no readings, got ${JSON.stringify(theirs)}`,
        )
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        await sharer.as('PUT', share, { level: 'off', everyone: false, userIds: [] })
        await sharer.as('DELETE', `/agent/devices/${deviceId}`)
      }
    },
  },
]
