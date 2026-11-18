// The Desktop app under test: the real Electron main process and renderer, started the
// way `bun run dev` starts them so they keep a profile of their own, and driven over the
// DevTools port the main process opens for ATLAS_DEV_CDP_PORT.
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright-core'

import { artifacts, freePorts, logPath, spawn, until } from './processes.ts'

import type { Page } from 'playwright-core'

const DESKTOP_DIR = resolve(import.meta.dirname, '../../apps/desktop')

/** `profile` is the app's own data directory; delete it once the app has exited. */
export type Desktop = { page: Page; profile: string; close: () => Promise<void> }

export async function startDesktop(apiUrl: string): Promise<Desktop> {
  const [vitePort, cdpPort] = await freePorts(2)
  const signIn = join(artifacts, 'sign-in')

  mkdirSync(signIn, { recursive: true })

  spawn('desktop', ['pnpm', 'exec', 'vite', '--port', String(vitePort), '--strictPort'], {
    cwd: DESKTOP_DIR,
    env: {
      NUPHOS_API_URL: apiUrl,
      // The app's sign-in files, kept apart from the logs so a run's artifacts carry no token.
      NUPHOS_CLI_CONFIG: join(signIn, 'cli.yaml'),
      // A name of its own gives the app a profile of its own, away from any installed app's.
      ATLAS_DEV_SUFFIX: `e2e-${String(cdpPort)}`,
      ATLAS_DEV_CDP_PORT: String(cdpPort),
      E2E_FAKE_MIC: '1',
    },
  })
  const cdp = `http://127.0.0.1:${String(cdpPort)}`

  await until(
    'Electron to open its DevTools port',
    async () => (await fetch(`${cdp}/json/version`)).ok,
    180_000,
  )
  const profile = /^\[user-data\] using (.+)$/m.exec(readFileSync(logPath('desktop'), 'utf8'))?.[1]

  if (!profile) throw new Error('The app did not report its data directory')
  const browser = await chromium.connectOverCDP(cdp)
  let page: Page | undefined

  await until('the app window', async () => {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().includes(`:${String(vitePort)}`))

    return page
  })

  return {
    page: page!,
    profile,
    close: async () => {
      await page!.screenshot({ path: join(artifacts, 'last-window.png') }).catch(() => {})
      await browser.close().catch(() => {})
    },
  }
}
