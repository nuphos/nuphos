// Run the real, unmodified released Desktop against the isolated e2e backend.
// E2E_OLD_DESKTOP points to an extracted official Linux AppImage executable.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { outdatedTurnScenarios } from './outdated-turn-scenarios.ts'
import { artifacts, freePorts, spawn, stopAll, until } from './processes.ts'
import { signInScenarios } from './sign-in-scenarios.ts'
import { startStack } from './stack.ts'

const binary = process.env.E2E_OLD_DESKTOP

if (!binary) throw new Error('Set E2E_OLD_DESKTOP to the official extracted Desktop executable')
let failed = false
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined

try {
  const stack = await startStack()
  const [port] = await freePorts(1)
  const profile = join(artifacts, 'old-desktop-profile')
  const bundle = join(artifacts, 'empty-local-bundle')

  mkdirSync(profile, { recursive: true })
  mkdirSync(bundle, { recursive: true })
  spawn(
    'old-desktop',
    [binary, '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`],
    {
      env: {
        NUPHOS_API_URL: stack.apiUrl,
        NUPHOS_CLI_CONFIG: join(profile, 'cli.yaml'),
        NUPHOS_LOCAL_RUNTIME_DIR: bundle,
        XDG_CONFIG_HOME: profile,
      },
    },
  )
  const cdp = `http://127.0.0.1:${port}`

  await until(
    'the released Desktop DevTools port',
    async () => (await fetch(`${cdp}/json/version`)).ok,
  )
  browser = await chromium.connectOverCDP(cdp)
  const page = browser.contexts()[0]!.pages()[0]!

  page.setDefaultTimeout(30_000)
  await page.waitForLoadState('domcontentloaded')
  try {
    await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
    await page.reload()
    await signInScenarios[1]!.run(page, stack)
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    })
    for (const scenario of outdatedTurnScenarios) {
      await scenario.run(page, stack)
      console.log(`PASS released Desktop: ${scenario.name}`)
    }
  } finally {
    await page.screenshot({ path: join(artifacts, 'old-desktop-last-window.png') })
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await browser?.close().catch(() => {})
  await stopAll()
}
process.exit(failed ? 1 : 0)
