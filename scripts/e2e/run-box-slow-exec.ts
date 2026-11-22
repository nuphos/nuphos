// `node --experimental-strip-types scripts/e2e/run-box-slow-exec.ts`: a new account's first Box
// joins, but instabox answers the exec that started its host only after the SDK's 15 s request
// cap. The Box is here, so it must stay.
import { backendLog } from './backend-log.ts'
import { startDesktop } from './desktop.ts'
import { instaboxExec } from './instabox-stub.ts'
import { artifacts, stopAll } from './processes.ts'
import { startStack } from './stack.ts'

import type { Desktop } from './desktop.ts'

let desktop: Desktop | undefined
let failed = false
const tunnels: WebSocket[] = []

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ boxes: true, freeBox: true })

  // The host starts and joins at once; the exec that started it answers 20 s later.
  instaboxExec.onRun = (_cmd, envs) => {
    const token = envs.NUPHOS_JOIN_TOKEN

    if (!token) return 0
    void join(stack.apiUrl, token)

    return 20_000
  }
  desktop = await startDesktop(stack.apiUrl)
  const { page } = desktop
  const email = `e2e-slow-exec-${String(Date.now())}@example.com`

  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await page.reload()
  await page.locator('input[type=email]').fill(email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await page.locator('input[placeholder="000000"]').fill(stack.signInCode(email) ?? '')
  await page.getByPlaceholder('Name your workspace…').fill('New user')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  // This instabox never answers the idle-pause change, which the SDK gives up on after about
  // a minute; then the host joins, its exec answers at 20 s and the SDK gives up at 15 s.
  const started = Date.now()

  for (const second of [10, 70, 90, 110, 130]) {
    await page.waitForTimeout(started + second * 1_000 - Date.now())
    await page.screenshot({ path: `${artifacts}/slow-exec-${String(second)}s.png` })
  }
  const events = backendLog()
    .filter((line) => /"event":"agent\.box\./.test(line))
    .map((line) => (JSON.parse(line) as { event: string }).event)

  console.log(events.join('\n'))
  if (events.some((event) => event.startsWith('agent.box.provision_failed')))
    throw new Error('A Box that joined was discarded')
  console.log('PASS a Box that joined stays, however late its exec answers')
} catch (error) {
  failed = true
  console.error(error)
  console.error(`FAIL: logs and screenshots are in ${artifacts}`)
} finally {
  for (const tunnel of tunnels) tunnel.close()
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)

/** What the host does with its join token: joins, then opens its tunnel and reports. */
async function join(apiUrl: string, token: string) {
  const joined = await fetch(`${apiUrl}/auth/devices/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, label: 'Computer 1', platform: 'linux' }),
  })
  const { deviceId, credential } = (await joined.json()) as { deviceId: string; credential: string }
  const tunnel = new WebSocket(
    `${apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
    { headers: { authorization: `Bearer ${credential}` } } as unknown as string[],
  )

  tunnels.push(tunnel)
  tunnel.addEventListener('message', () => tunnel.send(JSON.stringify({ t: 'pong' })))
  tunnel.addEventListener('open', () =>
    tunnel.send(JSON.stringify({ t: 'status', status: { agents: {} } })),
  )
}
