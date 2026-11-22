// The released Linux AppImage (E2E_OLD_APPIMAGE) updates itself to the build under test
// (E2E_NEW_APPIMAGE, version E2E_NEW_VERSION) from a feed served here. Run it where only
// loopback is reachable (`unshare -n`), so nothing the apps call reaches Nuphos Cloud.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { artifacts, freePorts, signalGroup, spawn, stopAll, until } from './processes.ts'

const {
  E2E_OLD_APPIMAGE: oldImage,
  E2E_NEW_APPIMAGE: newImage,
  E2E_NEW_VERSION: version,
} = process.env

if (!oldImage || !newImage || !version) {
  throw new Error('Set E2E_OLD_APPIMAGE, E2E_NEW_APPIMAGE and E2E_NEW_VERSION')
}
const sha512 = (file: string) => createHash('sha512').update(readFileSync(file)).digest('base64')
// Where the AppImage runtime unpacks the app it starts, as APPIMAGE_EXTRACT_AND_RUN asks.
const UPDATED = 'appimage_extracted_'
const updatedRunning = () => {
  try {
    return execFileSync('pgrep', ['-f', UPDATED]).length > 0
  } catch {
    return false
  }
}
let failed = false
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined

try {
  const [feedPort, cdpPort] = await freePorts(2)
  const name = `Nuphos-${version}-x86_64.AppImage`
  const newSha = sha512(newImage)
  const feed = createServer((request, response) => {
    if (request.url === `/${name}`) {
      response.writeHead(200, { 'content-length': statSync(newImage).size })
      createReadStream(newImage).pipe(response)

      return
    }
    response.end(
      `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${newSha}\n` +
        `    size: ${String(statSync(newImage).size)}\npath: ${name}\nsha512: ${newSha}\n`,
    )
  })

  await new Promise<void>((resolve) => feed.listen(feedPort, '127.0.0.1', resolve))
  feed.unref()

  // The installed app, run unpacked so its update feed can be pointed here. APPIMAGE tells
  // electron-updater which file to replace, as the AppImage runtime does for an installed one.
  const app = join(artifacts, 'Nuphos.AppImage')
  const env = {
    HOME: join(artifacts, 'home'),
    APPIMAGE_EXTRACT_AND_RUN: '1',
    NUPHOS_AUTO_UPDATE_IDLE_SECONDS: '30',
    POSTHOG_HOST: 'http://127.0.0.1:9',
  }

  copyFileSync(oldImage, app)
  chmodSync(app, 0o755)
  execFileSync(app, ['--appimage-extract'], { cwd: artifacts, stdio: 'ignore' })
  writeFileSync(
    join(artifacts, 'squashfs-root/resources/app-update.yml'),
    `provider: generic\nurl: http://127.0.0.1:${String(feedPort)}\n`,
  )
  const old = spawn('old-desktop', [join(artifacts, 'squashfs-root/AppRun'), '--no-sandbox'], {
    env: { ...env, APPIMAGE: app },
  })

  // Nobody touches the app, so once the download is ready it installs on its own.
  await until(
    'the update to replace the installed AppImage',
    async () => sha512(app) === newSha,
    300_000,
  )
  console.log('PASS the installed AppImage is the build under test')
  await until('the old app to exit', async () => !signalGroup(old, 0), 30_000)
  console.log('PASS the old app exits')
  await until('the updated app to start', async () => updatedRunning())
  console.log('PASS the updated app starts')

  // Started again with DevTools open, to read its version and screen.
  execFileSync('pkill', ['-KILL', '-f', UPDATED])
  await until('the updated app to stop', async () => !updatedRunning())
  spawn('updated-desktop', [app, '--no-sandbox', `--remote-debugging-port=${String(cdpPort)}`], {
    env,
  })
  const cdp = `http://127.0.0.1:${String(cdpPort)}`

  await until('the updated app DevTools port', async () => (await fetch(`${cdp}/json/version`)).ok)
  browser = await chromium.connectOverCDP(cdp)
  const page = browser.contexts()[0]!.pages()[0]!

  page.setDefaultTimeout(30_000)
  try {
    await page.waitForLoadState('domcontentloaded')
    const running = await page.evaluate(() =>
      (window as unknown as { api: { appGetVersion: () => Promise<string> } }).api.appGetVersion(),
    )

    if (running !== version) throw new Error(`The updated app runs ${running}, not ${version}`)
    await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
    await page.reload()
    await page.getByRole('button', { name: 'Continue with email' }).waitFor()
    console.log(`PASS the updated app runs ${version} and shows sign-in`)
  } finally {
    await page.screenshot({ path: join(artifacts, 'updated-desktop.png') })
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await browser?.close().catch(() => {})
  if (updatedRunning()) execFileSync('pkill', ['-KILL', '-f', UPDATED])
  await stopAll()
}
process.exit(failed ? 1 : 0)
