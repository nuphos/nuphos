// `bun scripts/e2e/run-box-pressure.ts` (#4877): a Box whose own load filled its CPU and memory
// never answers the exec that starts its host. Resume times out, reads instabox's samples, and the
// card and a conversation on the Box say what ran out. Every name here is made up.
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { boxRow, me } from './box-scenarios.ts'
import { startDesktop } from './desktop.ts'
import { instaboxExec, instaboxMachines } from './instabox-stub.ts'
import { artifacts, stopAll } from './processes.ts'
import { startStack } from './stack.ts'
import { openComputers } from './ui.ts'

import type { Desktop } from './desktop.ts'
import type { Locator } from 'playwright-core'

const { MongoClient } = (await import(
  resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb')
)) as typeof import('mongodb')
const LABEL = 'Build Box'
const CARD = /This computer ran out of CPU and memory at .* and stopped answering/u
const BANNER = `${LABEL} ran out of CPU or memory and stopped answering. It answers again once the load drops.`
const GIB = 1024 ** 3
let desktop: Desktop | undefined
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack({ boxes: true })

  // A machine this full never gets to answer the exec: the SDK gives up at 15 s.
  instaboxExec.onRun = () => 20_000
  const userId = await me(stack)
  const deviceId = randomUUID()
  const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
  const sample = (minutesAgo: number, cpuUsedPct: number, memUsed: number) => ({
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    cpuUsedPct,
    memUsed: memUsed * GIB,
    memTotal: 16 * GIB,
  })

  instaboxMachines.set(sandboxId, {
    id: sandboxId,
    state: 'running',
    operations: [],
    metrics: [sample(3, 41, 6.2), sample(2, 97, 14.8), sample(1, 100, 15.9)],
  })
  boxRow(stack.mongoUri, {
    userId,
    deviceId,
    label: LABEL,
    platform: 'linux',
    allowLocalExec: true,
    agents: [{ provider: 'claude-code', signedIn: true }],
    credentialHash: createHash('sha256').update(randomUUID()).digest('base64url'),
    box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: userId },
    access: [{ teamId: stack.teamId, everyone: false, userIds: [], managerIds: [] }],
  })
  const title = 'Nightly build'
  const mongo = await new MongoClient(stack.mongoUri).connect()

  await mongo
    .db('nuphos_e2e')
    .collection('agent_conversations')
    .insertOne({
      sessionId: `e2e-pressure-${randomUUID()}`,
      teamId: stack.teamId,
      userId,
      runtimeId: `local_${userId}_${deviceId}`,
      runtimeLabel: 'Claude Code',
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  await mongo.close()

  desktop = await startDesktop(stack.apiUrl)
  const { page } = desktop

  page.setDefaultTimeout(30_000)
  await page.evaluate(() => localStorage.setItem('nuphos.locale', 'en'))
  await page.reload()
  await page.locator('input[type=email]').fill(stack.email)
  await page.getByRole('button', { name: 'Continue with email' }).click()
  await page.getByText('Enter the 6-digit code').waitFor()
  await page.locator('input[placeholder="000000"]').fill(stack.signInCode(stack.email) ?? '')
  await page.getByText('Start with your first Bot').waitFor()
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })

  // Only the made-up Box and its conversation are shot: the computer running this suite is not.
  const around = async (target: Locator, name: string, pad: { up: number; down: number }) => {
    const box = await target.boundingBox()

    if (!box) throw new Error(`${name}: nothing to shoot`)
    await page.screenshot({
      path: `${artifacts}/${name}.png`,
      clip: {
        x: box.x - 24,
        y: box.y - pad.up,
        width: box.width + 48,
        height: box.height + pad.up + pad.down,
      },
    })
  }

  await openComputers(page)
  const label = page.getByText(LABEL, { exact: true }).first()

  await label.scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Resume', exact: true }).first().click()
  // The resume gives up on the exec, reads the samples and notes what ran out on the card.
  const notice = page.getByRole('status').filter({ hasText: CARD })

  await notice.getByText('Run top in its terminal', { exact: false }).waitFor({ timeout: 60_000 })
  await notice.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await around(notice, 'pressure-card', { up: 290, down: 60 })
  console.log('PASS the card says the Box ran out of CPU and memory, and what to do')

  await page.getByRole('button', { name: 'Back to app', exact: true }).click()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: title }).first().click()
  const banner = page.getByRole('status').filter({ hasText: BANNER })

  await banner.waitFor({ timeout: 30_000 })
  await banner.getByRole('button', { name: 'Restart' }).waitFor()
  await page.waitForTimeout(500)
  await around(banner, 'pressure-banner', { up: 40, down: 140 })
  console.log('PASS a conversation on the Box says it ran out of CPU or memory, with Restart')
} catch (error) {
  failed = true
  console.error(error)
  if (desktop) await desktop.page.screenshot({ path: `${artifacts}/pressure-failure.png` })
} finally {
  await desktop?.close(failed)
  await stopAll()
}
process.exit(failed ? 1 : 0)
