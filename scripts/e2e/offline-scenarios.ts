// Scenarios about a conversation whose computer is offline, almost out of disk, or out of date.
import { join } from 'node:path'

import { joinTeam } from './dashboard-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const LAPTOP = 'E2E laptop'
const MATE_LAPTOP = 'E2E teammate laptop'

const GIB = 1024 ** 3

// A computer of this person's with a signed-in Claude Code, online until the returned function
// is called. With `diskPercent` it also reports its readings, as full as that; `client` is the
// app it connects as; `owner` is whose computer it is, this person by default.
async function laptopOnline(
  stack: Stack,
  {
    diskPercent,
    client,
    owner = { token: stack.token, deviceId: 'e2e-laptop', label: LAPTOP },
  }: {
    diskPercent?: number
    client?: string
    owner?: { token: string; deviceId: string; label: string }
  } = {},
): Promise<() => void> {
  const authorization = `Bearer ${owner.token}`
  const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
    method: 'PUT',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: owner.deviceId,
      label: owner.label,
      platform: 'darwin',
      allowLocalExec: true,
    }),
  })

  if (!registered.ok) throw new Error(`Registering the laptop answered ${registered.status}`)
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${owner.deviceId}/runtime-tunnel`,
    {
      headers: { authorization, ...(client ? { 'x-atlas-client': client } : {}) },
    } as unknown as string[],
  )

  tunnel.addEventListener('message', () => tunnel.send(JSON.stringify({ t: 'pong' })))
  await new Promise((opened, failed) => {
    tunnel.addEventListener('open', opened)
    tunnel.addEventListener('error', failed)
  })
  tunnel.send(
    JSON.stringify({
      t: 'status',
      status: {
        localMetrics: diskPercent !== undefined,
        agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
      },
    }),
  )
  if (diskPercent === undefined) return () => tunnel.close()
  const report = () =>
    tunnel.send(
      JSON.stringify({
        t: 'metrics',
        metrics: {
          sampledAt: new Date().toISOString(),
          cpuPercent: 12,
          memory: { used: 6 * GIB, total: 16 * GIB },
          disk: { used: diskPercent * GIB, total: 100 * GIB },
        },
      }),
    )
  // A reading counts as live for 12 seconds.
  const reporting = setInterval(report, 4_000)

  report()

  return () => {
    clearInterval(reporting)
    tunnel.close()
  }
}

export const offlineScenarios: Scenario[] = [
  {
    // #3167: the banner said the computer was offline and offered only Retry.
    name: 'a conversation whose computer went offline offers another runtime, and moving sends again',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack)

      await newTask(page)
      await send(page, 'Before the laptop E2E_DELIVERY:before-offline')
      await page.getByText('ACK E2E_DELIVERY:before-offline').waitFor()
      await page.getByRole('button', { name: /^Runtime:/ }).click()
      await page.getByRole('menu').getByText(LAPTOP).first().click()
      await page
        .getByRole('menuitem', { name: /Claude Code/ })
        .last()
        .click()
      await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
      goOffline()
      const banner = page.getByRole('status').filter({ hasText: `${LAPTOP} is offline.` })

      await banner.waitFor()
      await page.screenshot({ path: join(artifacts, 'offline-banner.png') })
      await banner.getByRole('button', { name: 'Switch runtime' }).click()
      await page.getByRole('menu').getByText('E2E fixture agent').click()
      await page.getByRole('menuitem', { name: /^E2E fixture agent.*Claude Code/ }).click()
      await until('the banner to leave', async () => (await banner.count()) === 0)
      await send(page, 'After the laptop E2E_DELIVERY:after-offline')
      await page.getByText('ACK E2E_DELIVERY:after-offline').waitFor()
    },
  },
  {
    // #3181: a disk about to fill was only a gauge, until a turn failed on it.
    name: 'a conversation on a computer whose disk is almost full says so, and leads to the computer',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, { diskPercent: 93 })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-disk')
        await page.getByText('ACK E2E_DELIVERY:before-disk').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await page
          .getByRole('menuitem', { name: /Claude Code/ })
          .last()
          .click()
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page.getByRole('status').filter({
          hasText: `${LAPTOP}’s disk is almost full (93%). Bots and tasks on it may fail.`,
        })

        await banner.waitFor()
        await page.screenshot({ path: join(artifacts, 'disk-banner.png') })
        await banner.getByRole('button', { name: 'Free space' }).click()
        await page.getByText('Disk almost full: 7 GB free').waitFor()
        // The cards fade in; the picture is taken once they have.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: join(artifacts, 'disk-computer.png') })
      } finally {
        goOffline()
      }
    },
  },
  {
    // #3182: a computer on a Nuphos too old to run a conversation failed without saying why.
    name: 'a conversation on a computer whose Nuphos is out of date says so, and leads to the computer',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, { client: 'nuphos-desktop/0.119.0' })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-outdated')
        await page.getByText('ACK E2E_DELIVERY:before-outdated').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await page
          .getByRole('menuitem', { name: /Claude Code/ })
          .last()
          .click()
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page
          .getByRole('status')
          .filter({ hasText: `Nuphos on ${LAPTOP} is out of date. Bots and tasks on it may fail.` })

        await banner.waitFor()
        await page.screenshot({ path: join(artifacts, 'outdated-banner.png') })
        await banner.getByRole('button', { name: 'Update' }).click()
        await page.getByText('Nuphos on this computer is out of date').waitFor()
        await page.getByText('Open Nuphos on it and restart to update.').waitFor()
        // The cards fade in; the picture is taken once they have.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: join(artifacts, 'outdated-computer.png') })
      } finally {
        goOffline()
      }
    },
  },
  {
    // #3446: someone who can only use the computer cannot free space on it, so they get no
    // banner; the runtime picker's disk meter says who can.
    name: "a teammate's computer whose disk is almost full says who can free space, without a banner",
    run: async (page, stack) => {
      const teammate = await joinTeam(stack, 'disk-owner')
      const me = (await (
        await fetch(`${stack.apiUrl}/auth/me`, {
          headers: { authorization: `Bearer ${stack.token}` },
        })
      ).json()) as { id: string }
      const owner = { token: teammate.token, deviceId: 'e2e-teammate-laptop', label: MATE_LAPTOP }
      const goOffline = await laptopOnline(stack, { diskPercent: 93, owner })
      // Who may use the teammate's computer: just this person, then no one again, so it does
      // not linger in this person's runtime picker for the scenarios after this one.
      const share = (userIds: string[]) =>
        fetch(`${stack.apiUrl}/agent/devices/${owner.deviceId}/share?teamId=${stack.teamId}`, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${teammate.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            level: userIds.length > 0 ? 'full' : 'off',
            everyone: false,
            userIds,
            managerIds: [],
          }),
        })

      try {
        const shared = await share([me.id])

        if (!shared.ok) throw new Error(`Sharing the teammate's laptop answered ${shared.status}`)
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-shared-disk')
        await page.getByText('ACK E2E_DELIVERY:before-shared-disk').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        const disk = page.getByRole('menu').getByRole('meter', { name: 'DISK usage' })
        // The teammate joined after this app loaded its members, so it may name them, or fall
        // back to "the computer's owner" as the picker's "Shared by a teammate" line does.
        const whoCanFree = new RegExp(
          `^${MATE_LAPTOP}’s disk is almost full \\(93%\\)\\. Ask (?:${teammate.email.replace(/[.+]/g, '\\$&')}|the computer’s owner) to free space\\.$`,
          'u',
        )

        await until('the disk meter to say who can free space', async () => {
          const seen = await Promise.all(
            (await disk.all()).map(
              async (meter) => (await meter.getAttribute('title')) ?? '(no title)',
            ),
          )

          if (!seen.some((title) => whoCanFree.test(title)))
            throw new Error(`The disk meters' titles were ${JSON.stringify(seen)}`)

          return true
        })
        await page.screenshot({ path: join(artifacts, 'disk-shared-meter.png') })
        await page.getByRole('menu').getByText(MATE_LAPTOP).first().click()
        await page
          .getByRole('menuitem', { name: /Claude Code/ })
          .last()
          .click()
        // A teammate's computer asks first: its owner can see the work.
        await page.getByRole('button', { name: 'Move', exact: true }).click()
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        // The device list is read once the runtime is picked; give it time to say anything.
        await page.waitForTimeout(3_000)
        const banners = await page
          .getByRole('status')
          .filter({ hasText: `${MATE_LAPTOP}’s disk is almost full` })
          .count()

        if (banners > 0) throw new Error('Someone who cannot free space was shown the disk banner')
        await page.screenshot({ path: join(artifacts, 'disk-shared-no-banner.png') })
      } finally {
        await share([]).catch(() => null)
        goOffline()
      }
    },
  },
]
