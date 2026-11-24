// #4977: an agent asks for its computer with a `computer` card. The card shows that computer's
// desktop live, Take over hands the person its input, and I'm done hands it back and answers the
// card. The computer is a stand-in speaking the Mac host's protocol (fake-mac-screen-host.mjs).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'
import { fixtureBundle } from './tunnel-scenarios.ts'
import { newTask, openComputers, pickInRow, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const LABEL = 'E2E Studio'
const QUESTION = 'Sign in to the example dashboard'
const HOST = join(artifacts, 'fake-mac-screen-host-card')
const HOST_LOG = join(artifacts, 'fake-mac-screen-host-card.log')

/** The desktop's canvas in the card, once it shows the stand-in's colour bars. */
async function painted(page: Page) {
  return page.evaluate((question) => {
    // The question is also marked where it is not on screen, so look in every copy.
    const canvas = [
      ...document.querySelectorAll(`[data-decision-question="${question}"] canvas`),
    ].find((each) => each instanceof HTMLCanvasElement && each.width === 1280 && each.clientWidth)

    if (!(canvas instanceof HTMLCanvasElement)) return false
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    const colours = new Set<string>()

    for (let i = 0; i < pixels.length; i += 4 * 997)
      colours.add(`${String(pixels[i])},${String(pixels[i + 1])},${String(pixels[i + 2])}`)

    return colours.size >= 6
  }, QUESTION)
}

const pointers = () =>
  existsSync(HOST_LOG) ? (readFileSync(HOST_LOG, 'utf8').match(/ pointer /gu)?.length ?? 0) : 0

/** Adds the fixture agent as Claude Code on the computer, then opens a Task there. */
async function newTaskOn(page: Page, label: string) {
  await openComputers(page)
  await page.getByRole('button', { name: `New runtime on ${label}` }).click()
  await page.getByRole('menuitem', { name: 'Claude Code', exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  const code = page.getByPlaceholder('Paste code')

  await code.waitFor({ timeout: 60_000 })
  await code.fill('e2e-code#e2e-state')
  await page.keyboard.press('Enter')
  await page.getByText(/is ready\./).waitFor({ timeout: 60_000 })
  await page.getByText('Back to app', { exact: true }).click()
  await newTask(page)
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await pickInRow(page, label, /^Claude Code/)
}

export const computerCardScenarios: Scenario[] = [
  {
    name: 'a computer card shows its desktop live, Take over hands the person its input, and I’m done hands it back and answers',
    // The card's view may ask before the computer reports the screen it just opened.
    expected: /\/runtime-desktop\/[^"]+","status":404/u,
    run: async (page, stack) => {
      writeFileSync(
        HOST,
        `#!/bin/sh\nexec node ${JSON.stringify(resolve(import.meta.dirname, 'fake-mac-screen-host.mjs'))} "$@"\n`,
        { mode: 0o755 },
      )
      const computer = await startSecondComputer(stack, LABEL, {
        runtimeDir: fixtureBundle(stack, 'computer-card'),
        env: { NUPHOS_E2E_MAC_SCREEN_HOST: HOST, NUPHOS_E2E_MAC_SCREEN_LOG: HOST_LOG },
      })

      try {
        await newTaskOn(page, LABEL)
        const call = {
          label: 'Ask',
          category: 'computer',
          question: QUESTION,
          body: 'The site wants a sign-in only you can do.',
        }

        await send(
          page,
          `Ask it E2E_CALL request_user_decision ${JSON.stringify(call)} E2E_DELIVERY:computer-card`,
        )
        await page.getByText('ACK E2E_DELIVERY:computer-card').waitFor({ timeout: 60_000 })
        const card = page.locator(`[data-decision-question="${QUESTION}"]:visible`)

        // Live, never a stored picture: the card's own canvas paints from the computer.
        await until('the card to show the desktop live', () => painted(page))
        await card.getByText('Live', { exact: true }).waitFor()
        await card.screenshot({ path: join(artifacts, 'computer-card-1-live.png') })

        // Take over: the desktop fills the chat pane, and the person's pointer reaches it.
        await card.getByRole('button', { name: 'Take over' }).click()
        await page.getByText('You’re in control').waitFor()
        const before = pointers()
        const box = await card.locator('canvas').boundingBox()

        if (!box) throw new Error('The held desktop has no canvas on screen')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3)
        await until('a pointer event to reach the computer', async () => pointers() > before)
        await page.screenshot({ path: join(artifacts, 'computer-card-2-in-control.png') })

        // I'm done, under the held desktop: it is handed back and the card is answered.
        await page.getByRole('button', { name: 'I’m done' }).first().click()
        await card.getByText(/^Handed back (by .+ )?after \S+/u).waitFor({ timeout: 30_000 })
        if ((await page.getByText('You’re in control').count()) > 0)
          throw new Error('The desktop is still held after I’m done')
        if ((await card.getByRole('button', { name: 'Take over' }).count()) > 0)
          throw new Error('An answered computer card still offers Take over')
        await card.screenshot({ path: join(artifacts, 'computer-card-3-handed-back.png') })
      } finally {
        await computer.stop()
      }
    },
  },
]
