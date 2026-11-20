// The Desktop app under test: the real Electron main process and renderer, started the
// way `bun run dev` starts them so they keep a profile of their own, and driven over the
// DevTools port the main process opens for ATLAS_DEV_CDP_PORT.
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright-core'

import { artifacts, freePorts, logPath, spawn, stop, until } from './processes.ts'

import type { Page } from 'playwright-core'

const DESKTOP_DIR = resolve(import.meta.dirname, '../../apps/desktop')

/** `profile` is the app's own data directory; delete it once the app has exited.
 * `traceNextScenario` traces the next scenario, dropping the last one's trace;
 * `close(true)` keeps the failing one as trace.zip (`npx playwright show-trace`). */
export type Desktop = {
  page: Page
  profile: string
  traceNextScenario: () => Promise<void>
  close: (failed?: boolean) => Promise<void>
  /** Quits the app, for one started beside the suite's own. */
  stop: () => Promise<void>
}

/** `name` keeps another app's logs and sign-in apart from the suite's; `env` adds a system proxy, say. */
export async function startDesktop(
  apiUrl: string,
  {
    name = 'desktop',
    env = {},
    suffix,
  }: { name?: string; env?: Record<string, string>; suffix?: string } = {},
): Promise<Desktop> {
  const [vitePort, cdpPort] = await freePorts(2)
  const signIn = join(artifacts, name === 'desktop' ? 'sign-in' : `sign-in-${name}`)

  mkdirSync(signIn, { recursive: true })

  const child = spawn(name, ['pnpm', 'exec', 'vite', '--port', String(vitePort), '--strictPort'], {
    cwd: DESKTOP_DIR,
    env: {
      ...env,
      NUPHOS_API_URL: apiUrl,
      // The app's sign-in files, kept apart from the logs so a run's artifacts carry no token.
      NUPHOS_CLI_CONFIG: join(signIn, 'cli.yaml'),
      // A name of its own gives the app a profile of its own, away from any installed app's.
      ATLAS_DEV_SUFFIX: suffix ?? `e2e-${String(cdpPort)}`,
      ATLAS_DEV_CDP_PORT: String(cdpPort),
      // Adding an agent installs fixture-claude.mjs, never a vendor's CLI.
      NUPHOS_E2E_AGENT_INSTALLER: resolve(import.meta.dirname, 'fixture-install.sh'),
    },
  })
  const cdp = `http://127.0.0.1:${String(cdpPort)}`

  await until(
    'Electron to open its DevTools port',
    async () => (await fetch(`${cdp}/json/version`)).ok,
    180_000,
  )
  const profile = /^\[user-data\] using (.+)$/m.exec(readFileSync(logPath(name), 'utf8'))?.[1]

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

  const tracing = page!.context().tracing
  let started = false

  return {
    page: page!,
    profile,
    traceNextScenario: async () => {
      if (started) await tracing.stopChunk()
      else await tracing.start({ screenshots: true, snapshots: true })
      started = true
      await tracing.startChunk()
    },
    close: async (failed) => {
      if (failed && started)
        await tracing.stopChunk({ path: join(artifacts, 'trace.zip') }).catch(() => {})
      await page!.screenshot({ path: join(artifacts, 'last-window.png') }).catch(() => {})
      // Not browser.close(): Electron ignores it, so it waited its full 30 s; stopAll ends the app.
    },
    stop: async () => {
      await browser.close().catch(() => {})
      await stop(child)
    },
  }
}
