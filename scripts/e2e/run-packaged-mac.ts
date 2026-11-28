// Temporary: e2e of the packaged macOS app (E2E_APP, a Nuphos.app from `electron-builder --dir`)
// against a loopback-only stack with a fictional account. Lives only on a throwaway branch.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, createReadStream, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright-core'

import { assertLoopbackOnly, backendEnv } from './backend-env.ts'
import { artifacts, freePorts, signInCode, spawn, stop, stopAll, until } from './processes.ts'
import { initiateReplicaSet, startMongo } from './stack.ts'

import type { Browser, Page } from 'playwright-core'

const appPath = process.env.E2E_APP
const feedZip = process.env.E2E_FEED_ZIP

if (!appPath || !feedZip) throw new Error('Set E2E_APP and E2E_FEED_ZIP')
const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const binary = join(appPath, 'Contents/MacOS/Nuphos')
const results: { check: string; ok: boolean; detail: string }[] = []
const record = (check: string, ok: boolean, detail = '') => {
  results.push({ check, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${check}${detail ? ` — ${detail}` : ''}`)
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(artifacts, `${name}.png`) }).catch(() => {})

async function step(check: string, run: () => Promise<string | void>) {
  try {
    record(check, true, (await run()) ?? '')
  } catch (error) {
    record(check, false, String(error instanceof Error ? error.message : error).slice(0, 400))
  }
}

async function connect(port: number): Promise<{ browser: Browser; page: Page }> {
  const cdp = `http://127.0.0.1:${String(port)}`

  await until('the packaged app DevTools port', async () => (await fetch(`${cdp}/json/version`)).ok)
  const browser = await chromium.connectOverCDP(cdp)
  let page: Page | undefined

  await until('the main window', async () => {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => /^(file|app|nuphos):/.test(p.url()) || p.url().includes('index.html'))

    return page
  })

  return { browser, page: page! }
}

async function openPage(page: Page, name: string) {
  await page.mouse.click(130, 30)
  await page.keyboard.type(name)
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
}

const [mongoPort, backendPort, cdpPort, webPort, feedPort, cdp2Port] = await freePorts(6)
const apiUrl = `http://127.0.0.1:${String(backendPort)}`
const web = `http://127.0.0.1:${String(webPort)}`
const email = 'packaged-e2e@example.com'
const feedRequests: string[] = []
let browser: Browser | undefined

try {
  console.log(`Artifacts: ${artifacts}`)
  const info = execFileSync('plutil', ['-p', join(appPath, 'Contents/Info.plist')]).toString()

  record('bundle', true, info.match(/"CFBundleShortVersionString" => "[^"]+"/)?.[0] ?? '')

  // A local site for the in-app browser: a page and a fake sign-in form.
  createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    if (req.method === 'POST' && req.url === '/login') {
      let body = ''

      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const who = new URLSearchParams(body).get('email') ?? ''

        res.end(`<title>Signed in</title><h1 id="done">Signed in as ${who.replace(/[<>&]/g, '')}</h1>`)
      })

      return
    }
    if (req.url === '/login') {
      res.end(
        '<title>Fake sign-in</title><h1>Sign in to Example</h1><form method="post" action="/login">' +
          '<input name="email" type="email" placeholder="Email"><input name="password" type="password" placeholder="Password">' +
          '<button type="submit">Sign in</button></form>',
      )

      return
    }
    res.end('<title>Packaged e2e page</title><h1 id="hello">Hello from the e2e page</h1>')
  }).listen(webPort, '127.0.0.1')

  // An update feed newer than the app, served only on loopback.
  const zipName = 'Nuphos-99.0.0-arm64-mac.zip'
  const sha = createHash('sha512').update(readFileSync(feedZip)).digest('base64')
  const size = String(statSync(feedZip).size)

  createServer((req, res) => {
    feedRequests.push(`${req.method ?? ''} ${req.url ?? ''}`)
    if (req.url?.startsWith(`/${zipName}`)) {
      res.writeHead(200, { 'content-length': size })
      createReadStream(feedZip).pipe(res)

      return
    }
    if (req.url?.startsWith('/latest-mac.yml')) {
      res.end(
        `version: 99.0.0\nfiles:\n  - url: ${zipName}\n    sha512: ${sha}\n    size: ${size}\n` +
          `path: ${zipName}\nsha512: ${sha}\nreleaseDate: '2026-11-28T00:00:00.000Z'\n`,
      )

      return
    }
    res.writeHead(404).end()
  }).listen(feedPort, '127.0.0.1')

  const mongoUri = startMongo(mongoPort)

  await until('MongoDB to become primary', async () => initiateReplicaSet(mongoUri))
  spawn(
    'backend',
    ['bun', 'run', '--preload', resolve(import.meta.dirname, 'cli-release-stub.ts'), 'src/index.ts'],
    { cwd: BACKEND_DIR, env: backendEnv(backendPort, apiUrl, mongoUri) },
  )
  await until('the backend', async () => (await fetch(`${apiUrl}/health/ready`)).ok, 120_000)
  await assertLoopbackOnly(backendPort)

  // Phase 1: the packaged app against the local backend.
  const desktop = spawn('desktop', [binary], {
    env: {
      NUPHOS_API_URL: apiUrl,
      ATLAS_DEV_CDP_PORT: String(cdpPort),
      POSTHOG_HOST: 'http://127.0.0.1:9',
    },
  })
  const connected = await connect(cdpPort)

  browser = connected.browser
  const { page } = connected

  page.setDefaultTimeout(30_000)

  await step('launch: packaged app runs Electron 45', async () => {
    const ua = await page.evaluate(() => navigator.userAgent)
    const electron = /Electron\/([\d.]+)/.exec(ua)?.[1] ?? ''

    if (!electron.startsWith('45.')) throw new Error(`UA ${ua}`)
    await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
    await page.reload()
    await page.locator('input[type=email]').waitFor()
    await shot(page, '01-launch-sign-in')

    return `Electron ${electron}, Chrome ${/Chrome\/([\d.]+)/.exec(ua)?.[1] ?? '?'}`
  })

  await step('sign-in: email code, team created, team opens', async () => {
    await page.locator('input[type=email]').fill(email)
    await page.getByRole('button', { name: 'Continue with email' }).click()
    await page.getByText('Enter the 6-digit code').waitFor()
    await until('the sign-in code', async () => signInCode(email))
    await page.locator('input[placeholder="000000"]').fill(signInCode(email) ?? '')
    await page.getByPlaceholder('Name your team…').fill('Packaged e2e')
    await page.getByRole('button', { name: 'Create team' }).click()
    await page.getByRole('button', { name: 'Set up later' }).click()
    await page.getByRole('button', { name: 'Open team' }).click()
    await page.waitForTimeout(2_000)
    await shot(page, '02-signed-in')
  })

  const inAppPage = (match: string) =>
    until(`an in-app browser page at ${match}`, async () =>
      browser!
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().startsWith(match)),
    )

  await step('in-app browser: opens a page', async () => {
    await openPage(page, 'Browser')
    const bar = page.getByLabel('Search or enter URL')

    await bar.fill(`${web}/`)
    await bar.press('Enter')
    const view = await inAppPage(`${web}/`)

    await view!.locator('#hello').waitFor()
    await page.waitForTimeout(1_000)
    await shot(page, '03-browser-page')

    return `rendered "${await view!.title()}"`
  })

  await step('in-app browser: a sign-in page signs in', async () => {
    const bar = page.getByLabel('Search or enter URL')

    await bar.fill(`${web}/login`)
    await bar.press('Enter')
    const view = await inAppPage(`${web}/login`)

    await view!.getByPlaceholder('Email').fill('someone@example.com')
    await view!.getByPlaceholder('Password').fill('not-a-real-password')
    await page.waitForTimeout(500)
    await shot(page, '04-browser-sign-in-form')
    await view!.getByRole('button', { name: 'Sign in' }).click()
    await view!.locator('#done').waitFor()
    await page.waitForTimeout(800)
    await shot(page, '05-browser-signed-in')

    return (await view!.locator('#done').textContent()) ?? ''
  })

  await step('in-app browser: a public HTTPS page', async () => {
    const bar = page.getByLabel('Search or enter URL')

    await bar.fill('https://example.com/')
    await bar.press('Enter')
    const view = await inAppPage('https://example.com')

    await view!.getByRole('heading', { name: 'Example Domain' }).waitFor()
    await page.waitForTimeout(800)
    await shot(page, '06-browser-https')
  })

  await step('terminal: node-pty shell runs a command', async () => {
    await openPage(page, 'Terminal')
    await page.locator('.xterm-rows').waitFor()
    await page.waitForTimeout(1_500)
    await page.locator('.xterm').click()
    await page.keyboard.type('echo PTY_$((40+5)) $TERM_PROGRAM')
    await page.keyboard.press('Enter')
    await page.locator('.xterm-rows', { hasText: 'PTY_45' }).waitFor()
    await shot(page, '07-terminal')
  })

  await step('artifact panel: an HTML artifact renders', async () => {
    const call = async (method: string, path: string, token = '', body?: unknown) => {
      const res = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      return (await res.json().catch(() => null)) as Record<string, unknown> | null
    }
    const before = signInCode(email)

    await call('POST', '/auth/email/request-code', '', { email })
    await until('a second sign-in code', async () => signInCode(email) !== before && signInCode(email))
    const verified = await call('POST', '/auth/email/verify-code', '', { email, code: signInCode(email) })
    const token = String(verified?.token ?? '')
    const me = await call('GET', '/auth/me', token)
    const userId = String((me?.user as { id?: string } | undefined)?.id ?? me?.id ?? '')
    const teams = await call('GET', '/teams', token)
    const list = (Array.isArray(teams) ? teams : (teams?.teams ?? [])) as { id?: string; _id?: string }[]
    const teamId = String(list[0]?.id ?? list[0]?._id ?? '')

    if (!userId || !teamId) throw new Error(`me=${JSON.stringify(me)} teams=${JSON.stringify(teams)}`)
    const script = `
      import { MongoClient } from 'mongodb'
      const [uri, teamId, userId] = process.argv.slice(1)
      const client = await new MongoClient(uri).connect()
      const db = client.db('nuphos_e2e')
      const now = new Date()
      const sessionId = 'e2e-packaged-artifact'
      await db.collection('agent_conversations').insertOne({ sessionId, teamId, userId,
        runtimeId: 'local_' + userId + '_e2e-device', runtimeLabel: 'Claude Code',
        title: 'Packaged artifact check', participantIds: [], messageCount: 2,
        transcriptUpdatedAt: now, lastActiveAt: now, createdAt: now, updatedAt: now })
      await db.collection('agent_messages').insertMany([
        { sessionId, userId, messageId: 'm0', index: 0, role: 'user',
          parts: [{ type: 'text', text: 'Show an artifact' }], createdAt: now, updatedAt: now },
        { sessionId, userId, messageId: 'm1', index: 1, role: 'assistant', parts: [
          { type: 'text', text: 'Here is the artifact.' },
          { type: 'tool', toolCallId: 'call-artifact-1', toolName: 'render_artifact', state: 'output-available',
            input: { artifactId: 'e2e-artifact', title: 'E2E artifact', kind: 'html',
              content: '<h1 id="art">Artifact rendered in the packaged app</h1>' },
            output: { ok: true } }], createdAt: now, updatedAt: now },
      ])
      await client.close()`

    execFileSync('bun', ['-e', script, mongoUri, teamId, userId], { cwd: BACKEND_DIR, timeout: 20_000 })
    await page.reload()
    await page.getByRole('tab', { name: 'Tasks' }).click()
    await page.getByText('Packaged artifact check').first().click()
    await page.getByText('Here is the artifact.').waitFor()
    await page.getByText('E2E artifact').first().click()
    await until('the artifact frame', async () => {
      for (const frame of page.frames()) {
        if (await frame.locator('#art').count().catch(() => 0)) return true
      }

      return false
    })
    await page.waitForTimeout(1_000)
    await shot(page, '08-artifact-panel')
  })

  await step('take-over helper: bundled mac-screen-host is present and signed', async () => {
    const host = join(appPath, 'Contents/Resources/local-runtime/mac-screen-host')

    if (!existsSync(host)) throw new Error('mac-screen-host missing from the bundle')
    // Throws if the helper carries no valid signature.
    execFileSync('codesign', ['--verify', host], { stdio: 'pipe' })

    return execFileSync('file', [host], { encoding: 'utf8' }).trim().split(': ')[1] ?? ''
  })

  await shot(page, '09-before-quit')
  await browser.close().catch(() => {})
  browser = undefined
  await stop(desktop)

  // Phase 2: the default (Cloud) endpoint, whose hosts the runner points at 127.0.0.1, so the
  // updater runs; its feed is the loopback one above, never the production feed.
  writeFileSync(
    join(appPath, 'Contents/Resources/app-update.yml'),
    `provider: generic\nurl: http://127.0.0.1:${String(feedPort)}\nupdaterCacheDirName: nuphos-updater\n`,
  )
  spawn('desktop-updater', [binary], {
    env: { ATLAS_DEV_CDP_PORT: String(cdp2Port), POSTHOG_HOST: 'http://127.0.0.1:9' },
  })
  const second = await connect(cdp2Port)

  browser = second.browser
  const states: string[] = []

  await step('auto-update: manifest parsed, newer version found, download requested', async () => {
    await until(
      'the updater to request the update zip',
      async () => feedRequests.some((r) => r.includes('.zip')),
      90_000,
    )
    await until(
      'the updater to settle',
      async () => {
        const state = await second.page.evaluate(() =>
          (window as unknown as { api: { updaterGetState: () => Promise<unknown> } }).api.updaterGetState(),
        )

        states.push(JSON.stringify(state))

        return /"kind":"(ready|error)"/.test(states.at(-1) ?? '')
      },
      120_000,
    ).catch(() => {})

    return `feed requests: ${feedRequests.join(', ')}; updater states seen: ${[...new Set(states)].join(' -> ')}`
  })
} catch (error) {
  record('harness', false, String(error))
} finally {
  await browser?.close().catch(() => {})
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ results, feedRequests }, null, 2))
  await stopAll()
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
