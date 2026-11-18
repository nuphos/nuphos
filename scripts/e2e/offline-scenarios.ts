// Scenarios about a conversation whose computer is offline, almost out of disk, or out of date.
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const LAPTOP = 'E2E laptop'

const GIB = 1024 ** 3

// A computer of this person's with a signed-in Claude Code, online until the returned function
// is called. With `diskPercent` it also reports its readings, as full as that; `client` is the
// app it connects as.
async function laptopOnline(
  stack: Stack,
  { diskPercent, client }: { diskPercent?: number; client?: string } = {},
): Promise<() => void> {
  const authorization = `Bearer ${stack.token}`
  const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
    method: 'PUT',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'e2e-laptop',
      label: LAPTOP,
      platform: 'darwin',
      allowLocalExec: true,
    }),
  })

  if (!registered.ok) throw new Error(`Registering the laptop answered ${registered.status}`)
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/e2e-laptop/runtime-tunnel`,
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
        // #3567: the banner floats above the composer; the transcript keeps its last message clear
        // of it. A short, narrow window makes the transcript scroll and the reason wrap, so the
        // banner is taller than the room below the last message and has something to cover.
        const last = page.getByText(`moved this task from E2E fixture agent to`).last()
        const size = await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }))
        const measure = async () => {
          const message = await last.boundingBox()
          const tab = await banner.boundingBox()
          const scroll = await last.evaluate((node) => {
            const scroller = node.closest('.overflow-auto')

            return scroller
              ? {
                  overflows: scroller.scrollHeight > scroller.clientHeight,
                  fromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
                }
              : { overflows: false, fromBottom: Number.NaN }
          })

          return {
            ...scroll,
            messageBottom: message ? message.y + message.height : Number.NaN,
            bannerTop: tab?.y ?? Number.NaN,
          }
        }
        // Without the reserved room, as before the fix: the host's height is set back to 0.
        const withoutRoom = (off: boolean) =>
          last.evaluate((node, zero) => {
            const host = node.closest<HTMLElement>('[data-agent-status-host]')
            const scroller = node.closest('.overflow-auto')

            if (zero) {
              host?.setAttribute(
                'data-saved-room',
                host.style.getPropertyValue('--agent-status-banner-height'),
              )
              host?.style.setProperty('--agent-status-banner-height', '0px')
            } else {
              host?.style.setProperty(
                '--agent-status-banner-height',
                host.getAttribute('data-saved-room') ?? '',
              )
              host?.removeAttribute('data-saved-room')
            }
            if (scroller) scroller.scrollTop = scroller.scrollHeight
          }, off)

        await page.setViewportSize({ width: 720, height: 420 })
        try {
          for (const theme of ['light', 'dark']) {
            await page.evaluate((value) => {
              document.documentElement.classList.remove('light', 'dark')
              document.documentElement.classList.add(value)
            }, theme)
            await page.waitForTimeout(500)
            const room = await measure()

            await page.screenshot({ path: join(artifacts, `disk-banner-${theme}.png`) })
            if (!room.overflows)
              throw new Error('The transcript does not scroll; the check shows nothing')
            if (Number.isNaN(room.bannerTop) || room.messageBottom > room.bannerTop)
              throw new Error(
                `The last message ends at ${String(room.messageBottom)} px, under the banner at ${String(room.bannerTop)} px`,
              )
            if (Number.isNaN(room.fromBottom) || room.fromBottom > 2)
              throw new Error(`The transcript is ${String(room.fromBottom)} px from its bottom`)
            await withoutRoom(true)
            await page.waitForTimeout(300)
            await page.screenshot({
              path: join(artifacts, `disk-banner-${theme}-without-room.png`),
            })
            await withoutRoom(false)
          }
        } finally {
          await page.setViewportSize(size)
          await page.evaluate(() => {
            document.documentElement.classList.remove('dark')
            document.documentElement.classList.add('light')
          })
        }
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
]
