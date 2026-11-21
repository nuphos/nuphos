// Scenarios about a conversation whose computer is offline, almost out of disk, or out of date.
import { join } from 'node:path'

import { joinTeam } from './dashboard-scenarios.ts'
import { diskScenarios } from './disk-scenarios.ts'
import { LAPTOP, RESTORE_FAILED, laptopOnline } from './laptop-fixture.ts'
import { OUTDATED_LINE, backOnFixture } from './outdated-turn-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, pickInRow, send } from './ui.ts'

import type { Scenario } from './ui.ts'

const MATE_LAPTOP = 'E2E teammate laptop'

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
      await pickInRow(page, LAPTOP, /Claude Code/)
      await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
      goOffline()
      const banner = page.getByRole('status').filter({ hasText: `${LAPTOP} is offline.` })

      await banner.waitFor()
      await page.screenshot({ path: join(artifacts, 'offline-banner.png') })
      await banner.getByRole('button', { name: 'Switch runtime' }).click()
      await pickInRow(page, 'E2E fixture agent', /^E2E fixture agent.*Claude Code/)
      await until('the banner to leave', async () => (await banner.count()) === 0)
      await send(page, 'After the laptop E2E_DELIVERY:after-offline')
      await page.getByText('ACK E2E_DELIVERY:after-offline').waitFor()
    },
  },
  ...diskScenarios,
  {
    // #3182: a computer on a Nuphos too old to run a conversation failed without saying why.
    // Its Update opens the computer card's own confirmation where the user is, not the page.
    name: 'a conversation on a computer whose Nuphos is out of date says so, and updates it in place',
    // The turn there fails on purpose.
    expected: new RegExp(RESTORE_FAILED),
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, {
        client: 'nuphos-desktop/0.119.0',
        app: { version: '0.119.0', update: { version: '0.131.0', ready: true } },
        restoreFails: true,
      })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-outdated')
        await page.getByText('ACK E2E_DELIVERY:before-outdated').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await pickInRow(page, LAPTOP, /Claude Code/)
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page
          .getByRole('status')
          .filter({ hasText: `Nuphos on ${LAPTOP} is out of date. Bots and tasks on it may fail.` })

        await banner.waitFor()
        await page.screenshot({ path: join(artifacts, 'outdated-banner.png') })
        // #3562: a turn that fails there says why, also where no banner shows (Slack, channels).
        await send(page, 'On the old laptop')
        await page.getByText(OUTDATED_LINE).waitFor()
        await page.screenshot({ path: join(artifacts, 'outdated-turn-error.png') })
        await banner.getByRole('button', { name: 'Update' }).click()
        const confirm = page.getByRole('alertdialog', { name: `Update ${LAPTOP}?` })

        await confirm
          .getByText(`This restarts Nuphos on ${LAPTOP} now to install v0.131.0.`)
          .waitFor()
        await confirm.getByText('A Task running on it stops where it is').waitFor()
        await confirm.getByRole('button', { name: 'Update and restart' }).waitFor()
        await page.screenshot({ path: join(artifacts, 'outdated-confirm.png') })
        await confirm.getByRole('button', { name: 'Cancel' }).click()
        // Still in the conversation: nothing navigated away to the computer's page.
        await confirm.waitFor({ state: 'hidden' })
        await page.getByText('ACK E2E_DELIVERY:before-outdated').waitFor()
        if (await page.getByText('Nuphos on this computer is out of date').isVisible())
          throw new Error('The banner Update left the conversation for the computer page')
        await backOnFixture(page, 'after-outdated')
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
        await pickInRow(page, MATE_LAPTOP, /Claude Code/)
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
