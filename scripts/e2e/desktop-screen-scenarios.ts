// Open desktop on a computer's own screen paints, takes input and paints again after its host
// left (#2947, #2954); one that never shows a picture gives up with Try again. The hosts are
// stand-ins speaking the Mac host's protocol (fake-mac-screen-host.mjs), so any CI computer runs it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { join as joinTeam } from './agent-sign-in-scenarios.ts'
import { client, must } from './binding-access-scenarios.ts'
import { me } from './box-scenarios.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { openComputers } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'E2E screen'
const BLANK_LABEL = 'E2E blank screen'
const BOX_LABEL = 'E2E Box screen'
/** Runs the stand-in through node, so it needs no executable bit in the checkout. */
const HOST = join(artifacts, 'fake-mac-screen-host')
/** The host leaves a minute after its last viewer; this is longer, so the reopen starts it again. */
const REOPEN_AFTER_MS = 90_000
/** Seven attempts of 8 s each, plus the viewer's backoff between them (desktopConnection.ts). */
const GIVE_UP_MS = 150_000

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
      colours.add(`${String(pixels[i])},${String(pixels[i + 1])},${String(pixels[i + 2])}`)
    }

    return { opaque, colours: colours.size }
  })
}

async function openDesktop(page: Page, label: string) {
  await openComputers(page)
  await page.getByRole('button', { name: `Manage ${label}` }).click()
  await page.getByRole('menuitem', { name: 'Open desktop' }).click()
}

async function openScreen(page: Page, hostLog: string, round: string) {
  await openDesktop(page, LABEL)
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
  await page.getByRole('button', { name: /^Close tab Desktop/u }).click()
}

/** A screen that connects but never draws: the tab says it is reconnecting, then gives up with Try again. */
async function blankScreenGivesUp(page: Page) {
  await openDesktop(page, BLANK_LABEL)
  const status = (text: string) => page.getByRole('status').filter({ hasText: text })

  await until('a picture-less screen to reconnect', () => status('Reconnecting').isVisible())
  await until(
    'a picture-less screen to give up',
    () => status('Could not reach the desktop.').isVisible(),
    GIVE_UP_MS,
  )
  if (
    !(await status('Could not reach the desktop.')
      .getByRole('button', { name: 'Try again' })
      .isVisible())
  )
    throw new Error('A screen that gave up offers no Try again')
  await page.screenshot({ path: join(artifacts, 'desktop-screen-blank.png') })
  await page.getByRole('button', { name: /^Close tab Desktop/u }).click()
}

/**
 * Makes a connected computer a Box on the e2e instabox, as Nuphos records one its user ordered,
 * shared with `userIds`, of whom `managerIds` manage it.
 */
async function makeBox(
  stack: Stack,
  deviceId: string,
  sandboxId: string,
  share: { userIds: string[]; managerIds: string[] },
) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, deviceId, box, share] = process.argv.slice(1)
    const client = await new MongoClient(uri).connect()
    const access = [{ teamId: JSON.parse(box).teamId, everyone: false, ...JSON.parse(share) }]
    await client.db('nuphos_e2e').collection('agent_devices').updateOne({ deviceId }, { $set: { box: JSON.parse(box), access } })
    await client.close()`
  const box = { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: await me(stack) }

  instaboxMachines.set(sandboxId, { id: sandboxId, state: 'running', operations: [] })
  execFileSync(
    'bun',
    ['-e', script, stack.mongoUri, deviceId, JSON.stringify(box), JSON.stringify(share)],
    {
      cwd: resolve(import.meta.dirname, '../../apps/backend'),
      timeout: 10_000,
    },
  )
}

// A screen's stream is not found until its host has started and the computer reports it.
const SCREEN_NOT_UP_YET = /\/runtime-desktop\/runtime\/[^"]+\/0","status":404/u
// That, or the Box's screen refused to a teammate who only uses it.
const BOX_SCREEN_404 = /\/runtime-desktop\/runtime\/[^"]+","status":404/u

export const desktopScreenScenarios: Scenario[] = [
  {
    name: 'a computer’s screen paints, takes input, and paints again when opened after its host left; one with no picture gives up with Try again',
    expected: SCREEN_NOT_UP_YET,
    run: async (page, stack) => {
      writeFileSync(
        HOST,
        `#!/bin/sh\nexec node ${JSON.stringify(resolve(import.meta.dirname, 'fake-mac-screen-host.mjs'))} "$@"\n`,
        { mode: 0o755 },
      )
      const hostLog = join(artifacts, 'fake-mac-screen-host.log')
      const computer = await startSecondComputer(stack, LABEL, {
        env: { NUPHOS_E2E_MAC_SCREEN_HOST: HOST, NUPHOS_E2E_MAC_SCREEN_LOG: hostLog },
      })
      const blank = await startSecondComputer(stack, BLANK_LABEL, {
        env: { NUPHOS_E2E_MAC_SCREEN_HOST: HOST, NUPHOS_E2E_MAC_SCREEN_BLANK: '1' },
      })

      try {
        await openScreen(page, hostLog, 'first')
        const closedAt = Date.now()
        const starts = () => readFileSync(hostLog, 'utf8').match(/ listening$/gmu)?.length ?? 0

        // While the first screen's host idles out, the picture-less one runs its course.
        await blankScreenGivesUp(page)
        // #2954: the host has gone by the time the screen is opened again.
        await until(
          'the screen host to leave',
          async () => readFileSync(hostLog, 'utf8').includes(' exit idle'),
          REOPEN_AFTER_MS,
        )
        await page.waitForTimeout(Math.max(0, REOPEN_AFTER_MS - (Date.now() - closedAt)))
        await openScreen(page, hostLog, 'again')
        if (starts() !== 2)
          throw new Error(`The screen host started ${String(starts())} times, not twice`)
      } finally {
        await Promise.all([computer.stop(), blank.stop()])
      }
    },
  },
  {
    // #4100: instabox gives a workspace key no desktop link, so a Box's desktop opens through
    // its own host, as any of the owner's computers does, and never asks instabox for a link.
    // A teammate who manages the Box opens it too; one who only uses it does not.
    name: 'a Box’s desktop opens through its host and paints, also for a teammate who manages it',
    expected: BOX_SCREEN_404,
    run: async (page, stack) => {
      writeFileSync(
        HOST,
        `#!/bin/sh\nexec node ${JSON.stringify(resolve(import.meta.dirname, 'fake-mac-screen-host.mjs'))} "$@"\n`,
        { mode: 0o755 },
      )
      const computer = await startSecondComputer(stack, BOX_LABEL, {
        env: { NUPHOS_E2E_MAC_SCREEN_HOST: HOST },
      })
      const sandboxId = `m_e2e_${computer.deviceId.slice(0, 8)}`
      const owner = client(stack.apiUrl, stack.token)
      const manager = await joinTeam(stack, owner, 'box-manager')
      const user = await joinTeam(stack, owner, 'box-user')

      try {
        await makeBox(stack, computer.deviceId, sandboxId, {
          userIds: [manager.id, user.id],
          managerIds: [manager.id],
        })
        await openDesktop(page, BOX_LABEL)
        await until('the Box’s desktop to paint', async () => {
          const { opaque, colours } = await painted(page)

          return opaque > 500 && colours >= 6
        })
        await page.screenshot({ path: join(artifacts, 'desktop-screen-box.png') })
        await page.getByRole('button', { name: /^Close tab Desktop/u }).click()

        // Not the Box's creator: the device list offers its manager the Box's screen, which then
        // opens for them, and offers nothing to whoever only uses it, who is refused.
        const offered = async (as: typeof owner) => {
          const listed = (await as('GET', `/agent/devices?teamId=${stack.teamId}`)).body as {
            devices: { deviceId: string; desktopRuntimeId?: string }[]
          }

          return listed.devices.find((d) => d.deviceId === computer.deviceId)?.desktopRuntimeId
        }
        const runtimeId = await offered(manager.member)

        must(runtimeId !== undefined, 'the Box’s manager to be offered its screen')
        must((await offered(user.member)) === undefined, 'one who only uses it to be offered none')
        const open = `/teams/${stack.teamId}/runtime-desktop/runtime/${String(runtimeId)}`
        const opened = await manager.member('POST', open)

        must(
          opened.status === 200,
          `the manager to open it, got ${String(opened.status)} ${opened.text}`,
        )
        const refused = await user.member('POST', open)

        must(
          refused.status === 404,
          `one who only uses it to be refused, got ${String(refused.status)}`,
        )
      } finally {
        instaboxMachines.delete(sandboxId)
        await computer.stop()
      }
    },
  },
]
