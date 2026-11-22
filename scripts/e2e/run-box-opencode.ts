// `node --experimental-strip-types scripts/e2e/run-box-opencode.ts`: a new account's free Box runs
// OpenCode's free models, so onboarding lists it ready and a first Bot answers there with nothing
// connected here. OPENCODE names an OpenCode CLI, RUNTIME_DIR a staged local runtime.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { startDesktop } from './desktop.ts'
import { instaboxExec } from './instabox-stub.ts'
import { artifacts, spawn, stopAll } from './processes.ts'
import { DESKTOP_DIR } from './second-computer.ts'
import { startStack } from './stack.ts'

import type { Desktop } from './desktop.ts'

const opencode = process.env.OPENCODE ?? 'opencode'
const runtimeDir =
  process.env.RUNTIME_DIR ?? join(DESKTOP_DIR, 'build', 'local-runtime', 'linux-x64')
let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ boxes: true, freeBox: true })
  const host = join(DESKTOP_DIR, 'build', 'e2e-host.mjs')

  execFileSync(
    'bun',
    [
      'build',
      'electron/main/local-runtime/cli-host.ts',
      '--target=node',
      '--format=esm',
      '--external',
      '@napi-rs/keyring',
      `--outfile=${host}`,
    ],
    { cwd: DESKTOP_DIR, stdio: 'ignore' },
  )
  // The command that starts a Box's host starts it here, with the token it was given; the
  // stack's own accounts get free Boxes too, so each has a home of its own.
  let boxes = 0

  const startHost = (token: string, apiUrl = stack.apiUrl) => {
    const name = `box-${String(++boxes)}`
    const home = join(artifacts, name)

    mkdirSync(join(home, '.nuphos-agent'), { recursive: true })
    spawn(name, ['node', host], {
      env: {
        HOME: home,
        PATH: `${dirname(opencode)}:${process.env.PATH ?? ''}`,
        NUPHOS_AGENT_HOME: join(home, '.nuphos-agent'),
        NUPHOS_LOCAL_RUNTIME_DIR: runtimeDir,
        NUPHOS_API_URL: apiUrl,
        NUPHOS_JOIN_TOKEN: token,
      },
    })
  }

  instaboxExec.onRun = (_cmd, envs) => {
    if (envs.NUPHOS_JOIN_TOKEN) startHost(envs.NUPHOS_JOIN_TOKEN, envs.NUPHOS_API_URL)

    return 0
  }
  desktop = await startDesktop(stack.apiUrl)
  const { page } = desktop
  const email = `e2e-box-opencode-${String(Date.now())}@example.com`
  const light = () =>
    page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    })

  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await page.reload()
  await page.locator('input[type=email]').fill(email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await page.locator('input[placeholder="000000"]').fill(stack.signInCode(email) ?? '')
  await page.getByPlaceholder('Name your workspace…').fill('New user')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await page.getByText('OpenCode on Computer 1', { exact: true }).waitFor()
  await light()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/box-opencode-starting.png` })
  // The Box joins once instabox has answered the idle-pause change, about a minute here.
  await page.getByText('Free models, no sign-in needed').waitFor({ timeout: 4 * 60_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/box-opencode-ready.png` })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Open workspace' }).waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/box-opencode-complete.png` })
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await page.getByRole('button', { name: 'New Bot', exact: true }).click()
  await page.getByRole('textbox', { name: 'Bot name' }).fill('First Bot')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await light()
  const marker = `BOX-OPENCODE-${String(Date.now())}`
  // The composer in front: a Bot chat stays mounted, inert, behind the Bot's own page.
  const composer = page
    .locator(
      "xpath=//*[contains(concat(' ', @class, ' '), ' composer-surface ')][not(ancestor::*[@inert])] >> visible=true",
    )
    .getByRole('textbox')

  await composer.click()
  await page.keyboard.type(`Reply with exactly this word and nothing else: ${marker}`)
  await page.keyboard.press('Enter')
  // Once in the message sent, once more in OpenCode's answer.
  await page.waitForFunction((text) => document.body.innerText.split(text).length > 2, marker, {
    timeout: 6 * 60_000,
  })
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: `${artifacts}/box-opencode-bot-answer.png` })
  console.log('PASS a new account’s first Bot answers through OpenCode on its free Box')
} catch (error) {
  failed = true
  console.error(error)
  if (desktop) await desktop.page.screenshot({ path: `${artifacts}/box-opencode-failed.png` })
  console.error(`FAIL: logs and the last screenshot are in ${artifacts}`)
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
