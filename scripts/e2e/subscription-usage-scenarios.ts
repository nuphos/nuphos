// The Computers page's Subscription usage in the four states its design shows, on made-up
// computers whose week of readings is written straight to the e2e database.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { me } from './box-scenarios.ts'
import { computerWithUsage } from './channel-helpers.ts'
import { rest } from './leave-helpers.ts'
import { artifacts } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const HOUR = 3_600_000

type State = {
  name: string
  used: number
  /** When the weekly window last reset, in hours before now. */
  resetHoursAgo: number
  /** What a reading `hoursAgo` showed, before and after that reset. */
  reading: (hoursAgo: number) => number
  /** The pace line the chart's header shows. */
  says: RegExp
}

/** Climbs from `from` to `to` over a span, then stays at the limit once it reaches it. */
const ramp = (from: number, to: number, span: number, hoursAgo: number) =>
  Math.min(100, Math.round(from + ((to - from) * (span - hoursAgo)) / span))

const states: State[] = [
  {
    name: 'runs-out',
    used: 68,
    resetHoursAgo: 96,
    reading: (h) => (h > 96 ? ramp(70, 115, 72, h - 96) : ramp(0, 68, 96, h)),
    says: /runs out .*Then its Bots and Tasks switch to the fallback\./u,
  },
  {
    name: 'on-pace',
    used: 31,
    resetHoursAgo: 96,
    reading: (h) => (h > 96 ? ramp(40, 70, 72, h - 96) : ramp(0, 31, 96, h)),
    says: /about 54% will be used by the reset/u,
  },
  {
    name: 'used-up',
    used: 100,
    resetHoursAgo: 120,
    reading: (h) => (h > 120 ? ramp(60, 90, 48, h - 120) : ramp(0, 120, 120, h)),
    says: /Its Bots and Tasks use the fallback, .+, until the reset\./u,
  },
  {
    name: 'too-few',
    used: 4,
    // Only the live reading is newer than the reset.
    resetHoursAgo: 0.5,
    reading: (h) => ramp(30, 110, 167, h),
    says: /Too few readings since the reset/u,
  },
]

/** Writes (or, with `rows` null, removes) the readings and conversations of `runtimeIds`. */
function seed(stack: Stack, runtimeIds: string[], rows: Record<string, unknown> | null) {
  const script = `
    import { MongoClient } from 'mongodb'
    const [uri, ids, rows] = process.argv.slice(1).map((arg) => JSON.parse(arg))
    const client = await new MongoClient(uri).connect()
    const db = client.db('nuphos_e2e')
    if (rows) {
      await db.collection('agent_runtime_quota_samples').insertMany(
        rows.samples.map((s) => ({ ...s, _id: s.runtimeId + ':' + s.at, at: new Date(s.at) })))
      await db.collection('agent_conversations').insertMany(
        rows.conversations.map((c) => ({ ...c, createdAt: new Date(), updatedAt: new Date() })))
    } else {
      await db.collection('agent_runtime_quota_samples').deleteMany({ runtimeId: { $in: ids } })
      await db.collection('agent_conversations').deleteMany({ runtimeId: { $in: ids } })
    }
    await client.close()`

  execFileSync(
    'bun',
    [
      '-e',
      script,
      JSON.stringify(stack.mongoUri),
      JSON.stringify(runtimeIds),
      JSON.stringify(rows),
    ],
    { cwd: BACKEND_DIR, timeout: 30_000 },
  )
}

export const subscriptionUsageScenarios: Scenario[] = [
  {
    name: 'Subscription usage charts the selected runtime’s week in each pace state, wide and narrow',
    run: async (page, stack) => {
      const userId = await me(stack)
      const now = Date.now()
      const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString()
      const computers = states.map((state) => ({
        ...state,
        label: `E2E usage ${state.name}`,
        deviceId: randomUUID(),
      }))
      const runtimeIds = computers.map(({ deviceId }) => `local_${userId}_${deviceId}`)
      const forget = await Promise.all(
        computers.map(({ label, deviceId, used, resetHoursAgo }) =>
          computerWithUsage(stack, label, deviceId, undefined, {
            five_hour: { utilization: Math.round(used / 2), resets_at: at(-2) },
            seven_day: { utilization: used, resets_at: at(resetHoursAgo - 7 * 24) },
          }),
        ),
      )
      const owner = rest(stack, stack.token)
      const fallback = (
        await owner<{ runtimes: { id: string; label: string }[] }>(
          'GET',
          `/teams/${stack.teamId}/agent-runtimes`,
        )
      ).runtimes.find((runtime) => runtime.label === 'E2E second agent')

      if (!fallback) throw new Error('E2E second agent is not listed')
      seed(stack, runtimeIds, {
        samples: computers.flatMap((computer, i) =>
          Array.from({ length: 7 * 24 - 1 }, (_, h) => ({
            runtimeId: runtimeIds[i],
            at: at(h + 1),
            windows: [{ id: 'seven_day', label: 'Weekly', usedPercent: computer.reading(h + 1) }],
          })),
        ),
        // Made-up work on the first runtime, for its panel's list.
        conversations: [
          { sessionId: randomUUID(), title: 'Release notes writer', avatar: '05-rembrandt' },
          { sessionId: randomUUID(), title: 'Dependency bump' },
        ].map((row) => ({ ...row, teamId: stack.teamId, userId, runtimeId: runtimeIds[0] })),
      })
      for (const i of [0, 2])
        await owner('PUT', `/teams/${stack.teamId}/runtime-fallbacks/${runtimeIds[i]}`, {
          fallbackRuntimeId: fallback.id,
        })
      const size = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))
      const strip = page.getByText('At limit, last 7 days', { exact: true })

      try {
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await openComputers(page)
        for (const computer of computers) {
          const row = page
            .getByRole('region', { name: 'Runtimes' })
            .getByRole('button')
            .filter({ hasText: computer.label })

          await row.click()
          await page.getByText(computer.says).first().waitFor({ timeout: 30_000 })
          if (computer.name === 'runs-out')
            await page
              .locator('aside[aria-label]')
              .getByText('Bots and Tasks on this runtime')
              .waitFor({ timeout: 30_000 })
          for (const [width, wide] of [
            [1920, true],
            [1280, false],
          ] as const) {
            await page.setViewportSize({ width, height: 1080 })
            await page.waitForTimeout(600)
            if ((await strip.isVisible()) !== wide)
              throw new Error(
                `At ${String(width)} px the 7-day strip is ${wide ? 'hidden' : 'shown'}`,
              )
            await page.screenshot({
              path: `${artifacts}/subscription-usage-${computer.name}-${wide ? 'wide' : 'narrow'}-light.png`,
            })
          }
        }
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        await page.setViewportSize(size)
        for (const close of forget) close()
        seed(stack, runtimeIds, null)
      }
    },
  },
]
