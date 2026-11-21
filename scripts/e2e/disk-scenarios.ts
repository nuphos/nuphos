// The disk-almost-full banner: a computer with nothing to free, and a Box that clears caches.
// Then the out-of-memory notice on a computer's card (#4345).
import { join } from 'node:path'

import { instaboxMachines } from './instabox-stub.ts'
import { LAPTOP, laptopOnline } from './laptop-fixture.ts'
import { artifacts, until } from './processes.ts'
import { newTask, openComputers, pickInSubmenu, send } from './ui.ts'

import type { Scenario } from './ui.ts'

const BOX = 'E2E disk Box'
const MEMORY = 'In the last day, the system stopped a process because memory ran low'

export const diskScenarios: Scenario[] = [
  {
    // #3181: a disk about to fill was only a gauge, until a turn failed on it.
    // #3848: Free space is offered only where it clears caches in place, on a running Box the
    // viewer manages; a person's own computer has nothing to clear from here.
    name: 'a conversation on a computer whose disk is almost full says so, without a button that only navigates',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, { diskPercent: 93 })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-disk')
        await page.getByText('ACK E2E_DELIVERY:before-disk').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(LAPTOP).first().click()
        await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page.getByRole('status').filter({
          hasText: `${LAPTOP}’s disk is almost full (93%). Bots and tasks on it may fail.`,
        })

        await banner.waitFor()
        await page.screenshot({ path: join(artifacts, 'disk-banner.png') })
        // #3567, from #3568: the banner floats over the transcript's end, which keeps its last
        // message clear of it. A short, narrow window makes the transcript scroll and the reason
        // wrap, so the banner has something to cover.
        const last = page.getByText(`moved this task from E2E fixture agent to`).last()
        const size = page.viewportSize()

        await page.setViewportSize({ width: 720, height: 420 })
        try {
          await page.evaluate(() => {
            document.documentElement.classList.remove('dark')
            document.documentElement.classList.add('light')
          })
          await page.waitForTimeout(500)
          const message = await last.boundingBox()
          const top = (await banner.boundingBox())?.y ?? Number.NaN
          const scroll = await last.evaluate((node) => {
            const scroller = node.closest('.overflow-auto')!

            return {
              overflows: scroller.scrollHeight > scroller.clientHeight,
              fromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
            }
          })
          const bottom = message ? message.y + message.height : Number.NaN

          await page.screenshot({ path: join(artifacts, 'disk-banner-task-light.png') })
          if (!scroll.overflows)
            throw new Error('The transcript does not scroll; the check shows nothing')
          if (Number.isNaN(top) || Number.isNaN(bottom) || bottom > top + 1)
            throw new Error(
              `The last message ends at ${String(bottom)} px, under the banner at ${String(top)} px`,
            )
          if (scroll.fromBottom > 2)
            throw new Error(`The transcript is ${String(scroll.fromBottom)} px from its end`)
        } finally {
          if (size) await page.setViewportSize(size)
        }
        if ((await banner.getByRole('button', { name: 'Free space' }).count()) > 0)
          throw new Error('The banner offers Free space on a computer it cannot clear')
        // #4213: with nothing to free here, Dismiss is the only thing the person can do about
        // it. The warning goes and does not come back on the next reading; the computer's card
        // in settings keeps saying it.
        await banner.getByRole('button', { name: 'Dismiss for today' }).click()
        await until('the dismissed disk warning to go', async () => (await banner.count()) === 0)
        // It does not come back on the next reading of the same computer.
        await page.waitForTimeout(3_000)
        if ((await banner.count()) > 0) throw new Error('The dismissed disk warning came back')
        await page.screenshot({ path: join(artifacts, 'disk-banner-dismissed-light.png') })
      } finally {
        // Scenarios after this one see the laptop as it was: the dismissal is per computer and
        // would otherwise outlive this one by a day.
        await page.evaluate(() => localStorage.removeItem('nuphos.diskSnooze'))
        goOffline()
      }
    },
  },
  {
    // #3848: on a running Box the viewer manages, Free space opens its card's Clear caches
    // where the conversation is, instead of leading to the Computers page.
    name: 'a conversation on a Box whose disk is almost full clears its caches in place',
    run: async (page, stack) => {
      const goOffline = await laptopOnline(stack, { diskPercent: 93, box: BOX, busy: true })

      try {
        await newTask(page)
        await send(page, 'On the fixture E2E_DELIVERY:before-box-disk')
        await page.getByText('ACK E2E_DELIVERY:before-box-disk').waitFor()
        await page.getByRole('button', { name: /^Runtime:/ }).click()
        await page.getByRole('menu').getByText(BOX).first().click()
        await pickInSubmenu(page, page.getByRole('menuitem', { name: /Claude Code/ }).last())
        await page.getByText(`moved this task from E2E fixture agent to`).waitFor()
        const banner = page.getByRole('status').filter({
          hasText: `${BOX}’s disk is almost full (93%). Bots and tasks on it may fail.`,
        })

        await banner.getByRole('button', { name: 'Free space' }).click()
        const confirm = page.getByRole('alertdialog', { name: `Clear caches on ${BOX}?` })

        await confirm
          .getByText('Workspaces, sign-ins, Docker images and volumes are kept.')
          .waitFor()
        await confirm.getByText('Running Tasks aren’t stopped', { exact: false }).waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'disk-box-confirm.png') })
        await confirm.getByRole('button', { name: 'Cancel' }).click()
        await confirm.waitFor({ state: 'hidden' })
        await banner.getByRole('button', { name: 'Free space' }).click()
        await confirm.getByRole('button', { name: 'Clear caches', exact: true }).click()
        await page.getByText(`Clearing caches on ${BOX}`, { exact: true }).waitFor()
        await page.screenshot({ path: join(artifacts, 'disk-box-clearing.png') })
        if (
          ![...instaboxMachines.values()].some((machine) =>
            machine.commands?.some((cmd) => cmd.includes('docker builder prune -f')),
          )
        )
          throw new Error('The cache-clear command never reached the Box')
        // Still in the conversation: nothing navigated away to the computer's page.
        await page.getByText('ACK E2E_DELIVERY:before-box-disk').waitFor()
        await openComputers(page)
        await page.getByRole('button', { name: 'Clear caches', exact: true }).click()
        await confirm.waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'disk-box-card-confirm.png') })
        await confirm.getByRole('button', { name: 'Cancel' }).click()
        await page.getByRole('button', { name: 'Back to app', exact: true }).click()
      } finally {
        goOffline()
      }
    },
  },
  {
    // #4345: a Box whose host saw the kernel's OOM kill count rise says so on its card, through
    // the tunnel, the backend's presence and the devices list; a reading without it says nothing.
    name: 'a Box whose host recorded an OOM kill says a process was stopped for memory, and one without says nothing',
    run: async (page, stack) => {
      const killedAt = new Date(Date.now() - 12 * 60_000).toISOString()
      let goOffline = await laptopOnline(stack, {
        diskPercent: 50,
        box: BOX,
        oomKilledAt: killedAt,
      })

      try {
        await openComputers(page)
        const notice = page.getByRole('status').filter({ hasText: MEMORY })

        await notice
          .getByText('Run fewer Bots, Tasks, builds or browsers at once', { exact: false })
          .waitFor()
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        // The Box's card sits after the others in a row that scrolls sideways: bring it on screen.
        await notice.scrollIntoViewIfNeeded()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'memory-box-card-light.png') })
        goOffline()
        // The same Box again, its host reporting no kill: a reconnect alone is not a memory story.
        goOffline = await laptopOnline(stack, { diskPercent: 50, box: BOX })
        await until(
          'the removed card and its notice to go',
          async () => (await notice.count()) === 0,
        )
        await page.getByText(BOX, { exact: true }).first().waitFor()
        // Two more readings of the new Box: still nothing about memory.
        await page.waitForTimeout(10_000)
        if ((await page.getByText(MEMORY).count()) > 0)
          throw new Error('A reading without an OOM kill still shows the memory notice')
        await page.getByText(BOX, { exact: true }).first().scrollIntoViewIfNeeded()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'memory-box-card-none-light.png') })
        await page.getByRole('button', { name: 'Back to app', exact: true }).click()
      } finally {
        goOffline()
      }
    },
  },
]
