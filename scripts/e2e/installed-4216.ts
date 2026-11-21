// Released macOS Desktop, an isolated real backend, and a fictional runtime reading.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { laptopOnline, LAPTOP } from './laptop-fixture.ts'
import { artifacts, freePorts, logPath, spawn, stop, stopAll, until } from './processes.ts'
import { startStack } from './stack.ts'
import { newTask, pickAgent, pickInSubmenu, send } from './ui.ts'

import type { Page } from 'playwright-core'

const app = process.env.INSTALLED_APP
const home = process.env.ISOLATED_HOME

if (!app || !home) throw new Error('A temporary released app and isolated home are required')
const sandbox =
  '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
const cli = join(home, '.config', 'nuphos', 'cli.yaml')

mkdirSync(join(home, '.config', 'nuphos'), { recursive: true, mode: 0o700 })
mkdirSync(join(home, 'Library', 'Application Support'), { recursive: true, mode: 0o700 })
let online: (() => void) | undefined
let failure = ''
let page: Page | undefined
let launched: Awaited<ReturnType<typeof launch>> | undefined

async function launch(api: string, port: number) {
  const process = spawn(
    'installed-0.130.10',
    ['/usr/bin/sandbox-exec', '-p', sandbox, join(app!, 'Contents', 'MacOS', 'Nuphos'), '--no-sandbox'],
    {
      env: {
        HOME: home!,
        CFFIXED_USER_HOME: home!,
        NUPHOS_API_URL: api,
        NUPHOS_CLI_CONFIG: cli,
        ATLAS_DEV_CDP_PORT: String(port),
        POSTHOG_HOST: 'http://127.0.0.1:9',
      },
    },
  )
  const endpoint = `http://127.0.0.1:${port}`

  await until(
    'installed Desktop debugging endpoint',
    async () => (await fetch(`${endpoint}/json/version`)).ok,
    120_000,
  )
  const browser = await chromium.connectOverCDP(endpoint)
  let active: Page | undefined

  await until(
    'installed Desktop window',
    async () => {
      active = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith('app://'))

      return active
    },
    60_000,
  )
  active!.setDefaultTimeout(30_000)

  return { browser, page: active!, process }
}

async function chooseLaptop(current: Page) {
  await current.getByRole('button', { name: /^Runtime:/ }).click()
  await current.getByRole('menu').getByText(LAPTOP).first().click()
  await pickInSubmenu(current, current.getByRole('menuitem', { name: /Claude Code/ }).last())
}

const warning = (current: Page) =>
  current.getByRole('status').filter({ hasText: 'disk is almost full' })
const shot = (current: Page, name: string) =>
  current.screenshot({ path: join(artifacts, `${name}.png`) })

try {
  const stack = await startStack()
  const [port] = await freePorts(1)

  launched = await launch(stack.apiUrl, port)
  page = launched.page
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await page.reload()
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  let handle = ''
  await until('fixture Google native session', async () => {
    handle = /E2E_NATIVE_HANDLE=([^\s]+)/.exec(readFileSync(logPath('backend'), 'utf8'))?.[1] ?? ''
    return Boolean(handle)
  })
  // Drive the fictional provider leg locally; the app still redeems the actual one-time PKCE handoff.
  const provider = await fetch(`${stack.apiUrl}/auth/social/google/start?handle=${encodeURIComponent(handle)}`, { redirect: 'manual' })
  const callback = provider.headers.get('location')
  if (!callback || !callback.startsWith('http://127.0.0.1:')) throw new Error('Fixture Google callback missing')
  await fetch(callback)
  await page.getByText('Start with your first Bot').waitFor()
  online = await laptopOnline(stack, { diskPercent: 91 })
  await newTask(page)
  await pickAgent(page, 'E2E fixture agent')
  await send(page, 'Fictional first task E2E_DELIVERY:installed-first')
  await page.getByText('ACK E2E_DELIVERY:installed-first').waitFor({ timeout: 60_000 })
  await chooseLaptop(page)
  await warning(page).waitFor({ timeout: 90_000 })
  await shot(page, '01-warning')
  await warning(page).getByRole('button', { name: 'Dismiss for today' }).click()
  await warning(page).waitFor({ state: 'hidden' })
  await shot(page, '02-dismissed')
  await newTask(page)
  await pickAgent(page, 'E2E fixture agent')
  await send(page, 'Fictional second task E2E_DELIVERY:installed-second')
  await page.getByText('ACK E2E_DELIVERY:installed-second').waitFor({ timeout: 60_000 })
  await chooseLaptop(page)
  await page.waitForTimeout(65_000)
  if (await warning(page).isVisible()) throw new Error('Warning returned in the second chat')
  await shot(page, '03-other-chat')
  const existing = new Set(launched.browser.contexts().flatMap((context) => context.pages()))

  await page.evaluate(() =>
    (window as unknown as { api: { openPageWindow: (url: string) => void } }).api.openPageWindow(
      '/',
    ),
  )
  let second: Page | undefined

  await until('second Desktop window', async () => {
    second = launched!.browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => !existing.has(candidate) && candidate.url().startsWith('app://'))

    return second
  })
  second!.setDefaultTimeout(30_000)
  await second!.getByRole('tab', { name: 'Tasks' }).click()
  await second!.getByText('Fictional second task', { exact: false }).first().click()
  await second!.waitForTimeout(65_000)
  if (await warning(second!).isVisible()) throw new Error('Warning returned in a second window')
  await shot(second!, '04-second-window')
  await launched.browser.close()
  await stop(launched.process)
  launched = await launch(stack.apiUrl, port)
  page = launched.page
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByText('Fictional first task', { exact: false }).first().click()
  await page.waitForTimeout(65_000)
  if (await warning(page).isVisible())
    throw new Error('Warning returned after installed app restart')
  await shot(page, '05-restart')
  online()
  online = await laptopOnline(stack, { diskPercent: 95 })
  await warning(page).waitFor({ timeout: 90_000 })
  await shot(page, '06-worse')
  writeFileSync(
    join(artifacts, 'result.txt'),
    'PASS: installed macOS Desktop 0.130.10; fictional Google OAuth identity and isolated backend; fictional 91% reading; dismiss persisted across chats, window and restart; returned at 95%.\n',
  )
  console.log(
    'PASS installed macOS Desktop 0.130.10: dismiss across chats, window and restart; warning returned at 95%.',
  )
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  console.error(`FAIL installed Desktop flow: ${failure}`)
  const appLog = logPath('installed-0.130.10')

  if (existsSync(appLog)) {
    const lines = readFileSync(appLog, 'utf8').split('\n')
    const selected = lines
      .filter((line) => /fatal|error|sandbox|crash|user-data|exit|abort/i.test(line))
      .slice(-30)
    const safe = selected.map((line) =>
      line.replace(/(bearer|token|password|code)[=: ]+[^ ,]+/gi, '$1=[redacted]'),
    )

    writeFileSync(join(artifacts, 'diagnostic.txt'), safe.join('\n') + '\n')
  }
  if (page) await shot(page, 'failure').catch(() => {})
  writeFileSync(join(artifacts, 'result.txt'), `FAIL: ${failure}\n`)
} finally {
  online?.()
  await launched?.browser.close().catch(() => {})
  await stopAll()
}
if (failure) process.exitCode = 1
