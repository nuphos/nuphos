// `node --experimental-strip-types scripts/e2e/run-new-user.ts`: a brand-new account on a deployment with cloud computers, from
// sign-up to its first cloud computer, through the composer's own "Connect a runtime".
import { startDesktop } from './desktop.ts'
import { artifacts, stopAll } from './processes.ts'
import { startStack } from './stack.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  // With a URL for a cloud computer to dial, so this deployment offers them.
  const stack = await startStack({ boxes: true })

  desktop = await startDesktop(stack.apiUrl)
  const { page } = desktop
  // Not the stack's own account: that one already has runtimes.
  const email = `e2e-new-${String(Date.now())}@example.com`

  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await page.reload()
  await page.locator('input[type=email]').fill(email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await page.locator('input[placeholder="000000"]').fill(stack.signInCode(email) ?? '')
  await page.getByPlaceholder('Name your workspace…').fill('New user')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  const cloud = page.getByRole('button', { name: /^Rent a computer from Nuphos/ })

  // Each place a new user is asked for a runtime offers the cloud computer: onboarding,
  await cloud.waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/new-user-onboarding.png` })
  // No Claude Code or Codex on this computer: setting them up waits.
  await page.getByRole('button', { name: 'Set up later' }).click()
  await page.getByRole('button', { name: 'Open workspace' }).click()
  // their first Bot,
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('textbox', { name: 'Bot name' }).fill('E2E Bot')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await cloud.waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/new-user-new-bot.png` })
  // Back to naming the Bot, then closed.
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: 'Bot name' }).waitFor()
  await page.keyboard.press('Escape')
  await cloud.waitFor({ state: 'hidden' })
  // and a new task, where this one is made.
  // A new task's composer: with no runtime yet, it offers to connect one.
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'Connect a runtime' }).first().click()

  await cloud.waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/new-user-connect-runtime.png` })
  await cloud.click()
  await page.getByRole('button', { name: 'Create computer' }).waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/new-user-cloud-computer.png` })
  // Back returns to Connect a runtime, where it was chosen.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page
    .getByText('Connect a runtime', { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor()
  await cloud.waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/new-user-back.png` })
  await cloud.click()
  await page.getByRole('button', { name: 'Create computer' }).click()
  // Made: the Computers page, where the card's + adds a runtime such as OpenCode once the
  // computer is up. This instabox's computers never come up, so it stays connecting.
  await page.getByText('Computer 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add computer' }).waitFor()
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: `${artifacts}/new-user-computers.png` })
  console.log('PASS a new account makes a cloud computer from Connect a runtime')
} catch (error) {
  failed = true
  console.error(error)
  if (desktop) await desktop.page.screenshot({ path: `${artifacts}/new-user-failed.png` })
  console.error(`FAIL: logs and the last screenshot are in ${artifacts}`)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
