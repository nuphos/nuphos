// A computer's own screen opened from the Computers page, as Open desktop does for a Mac:
// the picture must paint, input must reach the computer, and opening it again after its
// host exited must paint again (#2947, #2954). The screen host is a stand-in speaking the Mac
// host's protocol (fake-mac-screen-host.mjs), so it runs on any CI computer.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'E2E screen'
const HOST = resolve(import.meta.dirname, 'fake-mac-screen-host.mjs')
/** The host leaves a minute after its last viewer; this is longer, so the reopen starts it again. */
const REOPEN_AFTER_MS = 90_000

/** How much of the screen's canvas shows the picture: opaque samples and distinct colours. */
async function painted(page: Page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(
      (each) => each.width === 1280 && each.height === 800,
    )
    if (!canvas || canvas.clientWidth === 0) return { opaque: 0, colours: 0 }
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    const colours = new Set<string>()
    let opaque = 0
    for (let i = 0; i < pixels.length; i += 4 * 997) {
      if (pixels[i + 3]) opaque++
      colours.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
    }

    return { opaque, colours: colours.size }
  })
}

async function openScreen(page: Page, hostLog: string, round: string) {
  await openComputers(page)
  await page.getByRole('button', { name: `Manage ${LABEL}` }).click()
  await page.getByRole('menuitem', { name: 'Open desktop' }).click()
  // The colour bars, not a blank or transparent canvas: about 1000 samples, 8 bars.
  await until(`the screen to paint (${round})`, async () => {
    const { opaque, colours } = await painted(page)

    return opaque > 500 && colours >= 6
  })
  await page.screenshot({ path: join(artifacts, `desktop-screen-${round}.png`) })
  // Input reaches the computer once the viewer takes it over.
  const pointers = () =>
    existsSync(hostLog) ? (readFileSync(hostLog, 'utf8').match(/ pointer /gu)?.length ?? 0) : 0
  const before = pointers()

  await page.getByRole('button', { name: 'Take over' }).click()
  const box = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find((each) => each.width === 1280)!
    const { x, y, width, height } = canvas.getBoundingClientRect()

    return { x, y, width, height }
  })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3)
  await until(`a pointer event to reach the computer (${round})`, async () => pointers() > before)
  await page.getByRole('button', { name: /^Close tab Desktop/ }).click()
}

export const desktopScreenScenarios: Scenario[] = [
  {
    name: 'a computer’s screen paints, takes input, and paints again when opened after its host left',
    run: async (page, stack) => {
      const hostLog = join(artifacts, 'fake-mac-screen-host.log')
      const computer = await startSecondComputer(stack, LABEL, {
        env: { NUPHOS_E2E_MAC_SCREEN_HOST: HOST, NUPHOS_E2E_MAC_SCREEN_LOG: hostLog },
      })

      try {
        await openScreen(page, hostLog, 'first')
        const closedAt = Date.now()
        const starts = () => readFileSync(hostLog, 'utf8').match(/ listening$/gmu)?.length ?? 0

        // #2954: the host has gone by the time the screen is opened again.
        await until('the screen host to leave', async () =>
          readFileSync(hostLog, 'utf8').includes(' exit idle'),
          REOPEN_AFTER_MS,
        )
        await page.waitForTimeout(Math.max(0, REOPEN_AFTER_MS - (Date.now() - closedAt)))
        await openScreen(page, hostLog, 'again')
        if (starts() !== 2) throw new Error(`The screen host started ${String(starts())} times, not twice`)
      } finally {
        await computer.stop()
      }
    },
  },
]
