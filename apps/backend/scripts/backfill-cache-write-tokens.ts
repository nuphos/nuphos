/**
 * Backfill `tokens.cacheWriteTokens` onto historical agent_token_usage rows,
 * from the cache_creation count their own `rawUsage` already carries, and
 * re-freeze the corrected providerCostUsd on the total rows.
 *
 * DRY RUN BY DEFAULT — it writes nothing unless you pass --apply.
 *
 *   bun run scripts/backfill-cache-write-tokens.ts --from 2026-07-01
 *   bun run scripts/backfill-cache-write-tokens.ts --from 2026-07-01 --to 2026-08-08 --apply
 *   bun run scripts/backfill-cache-write-tokens.ts --from 2026-07-01 --apply --refresh-summaries
 *
 * Flags:
 *   --from <ISO>            inclusive lower bound on createdAt (required)
 *   --to <ISO>              exclusive upper bound (default: now)
 *   --apply                 actually write (otherwise: report only)
 *   --refresh-summaries     rebuild the tokenUsage summary of every conversation
 *                           with cache-write rows in the window. Derived from
 *                           the window, not from this run's patches, so it is
 *                           resumable: rerun after a crash and it repairs what
 *                           the interrupted run left stale. Safe to run alone.
 *   --limit <n>             stop after n candidate rows (rehearsal on prod)
 *
 * Safety properties, all pinned by src/lib/agent/token-usage-backfill.test.ts:
 *   - idempotent: a row that already has cacheWriteTokens is skipped, so the
 *     job can be re-run, resumed, or overlapped without compounding;
 *   - never raises what a row COST. providerCostUsd on a total row is
 *     billing-authoritative (usage-boundary rereads it for partial cycle hours,
 *     overage settles from that), so rewriting it would retroactively charge a
 *     team for our own under-count. Tokens are fixed; withCostUsd recomputes
 *     display cost on read;
 *   - never invents a number: a row whose rawUsage has no cache_creation count
 *     is left untouched;
 *   - never re-credits the team usage pool. Those hours are settled and quota
 *     decisions were already made against them; retroactively charging users
 *     for our own under-count is not on the table. The report prints the total
 *     delta so the size of the correction is known.
 */
import { connectDb } from '@/lib/db'
import { agentTokenUsage } from '@/lib/agent/token-usage-db'
import {
  affectedSessionsPipeline,
  backfillCostDeltaUsd,
  backfillPatchForRecord,
} from '@/lib/agent/token-usage-backfill'
import { refreshConversationTokenUsageSummary } from '@/lib/agent/token-usage-summary'

import type { AnyBulkWriteOperation } from 'mongodb'
import type { AgentTokenUsageRecord } from '@/lib/agent/token-usage-db'

const BATCH_SIZE = 500

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function requiredDate(name: string): Date {
  const raw = flagValue(name)
  const date = raw ? new Date(raw) : new Date(Number.NaN)

  if (Number.isNaN(date.getTime())) {
    fail(`--${name} <ISO timestamp> is required and must parse as a date (got: ${String(raw)})`)
  }

  return date
}

function optionalDate(name: string, fallback: Date): Date {
  const raw = flagValue(name)

  if (!raw) return fallback
  const date = new Date(raw)

  // Silently falling back to `now` on a typo would widen the window without
  // saying so — with --apply that means writing rows the operator never asked
  // to touch.
  if (Number.isNaN(date.getTime())) fail(`--${name} is not a valid date: ${raw}`)

  return date
}

function optionalPositiveInt(name: string): number {
  const raw = flagValue(name)

  if (!raw) return Number.POSITIVE_INFINITY
  const value = Number(raw)

  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`--${name} must be a positive whole number (got: ${raw})`)
  }

  return value
}

type SessionKey = { sessionId: string; userId: string; teamId?: string }

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const refreshSummaries = process.argv.includes('--refresh-summaries')
  const from = requiredDate('from')
  const to = optionalDate('to', new Date())
  const limit = optionalPositiveInt('limit')

  // A reversed window matches nothing and reports a confident "0 patched",
  // which reads as "already done" rather than "you typed the dates backwards".
  if (from >= to) {
    fail(`--from must be before --to (got ${from.toISOString()} >= ${to.toISOString()})`)
  }

  await connectDb()
  const cursor = agentTokenUsage().find(
    {
      createdAt: { $gte: from, $lt: to },
      'tokens.cacheWriteTokens': { $exists: false },
      rawUsage: { $exists: true },
    },
    { sort: { createdAt: 1 } },
  )

  let scanned = 0
  let patched = 0
  let deltaUsd = 0
  let batch: AnyBulkWriteOperation<AgentTokenUsageRecord>[] = []
  // Report-only: how many conversations THIS run touched. The summary repair
  // deliberately does not use it — see the repair pass below.
  const sessions = new Set<string>()

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    if (apply) await agentTokenUsage().bulkWrite(batch, { ordered: false })
    batch = []
  }

  for await (const record of cursor) {
    if (scanned >= limit) break
    scanned++
    const patch = backfillPatchForRecord(record)

    if (!patch) continue
    patched++
    deltaUsd += backfillCostDeltaUsd(record, patch)
    batch.push({
      updateOne: {
        filter: { recordId: patch.recordId },
        update: { $set: patch.set },
      },
    })
    sessions.add(JSON.stringify([record.sessionId, record.userId]))
    if (batch.length >= BATCH_SIZE) await flush()
  }
  await flush()

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        window: { from: from.toISOString(), to: to.toISOString() },
        scanned,
        patched,
        conversationsTouchedThisRun: sessions.size,
        underBilledUsd: Number(deltaUsd.toFixed(6)),
        usagePoolCredited: false,
      },
      null,
      2,
    ),
  )

  if (!refreshSummaries) {
    process.exit(0)
  }
  // Summaries are rebuilt from the WINDOW, not from the rows this run happened
  // to patch. That is what makes the repair resumable: after a crash the
  // patched rows no longer match the candidate filter, so a session list built
  // during the patch pass comes back empty on the rerun and the stale summaries
  // would be stranded. Refreshing one that is already correct is a no-op, so
  // over-covering is the safe direction. Runnable on its own (--from/--to plus
  // --apply --refresh-summaries) as a pure repair pass.
  const repairTargets = await agentTokenUsage()
    .aggregate<SessionKey>(affectedSessionsPipeline({ from, to }))
    .toArray()

  if (!apply) {
    console.log(
      `--refresh-summaries would rebuild ${String(repairTargets.length)} conversation summaries (dry run — no writes).`,
    )
    process.exit(0)
  }

  let refreshed = 0
  let failed = 0

  for (const key of repairTargets) {
    try {
      await refreshConversationTokenUsageSummary(key.sessionId, key.userId, key.teamId)
      refreshed++
    } catch (err) {
      // Keep going: one unreadable conversation must not strand the rest, and
      // the rerun re-derives the same target list anyway.
      failed++
      console.error(`summary refresh failed for ${key.sessionId}/${key.userId}:`, err)
    }
  }
  console.log(
    `Refreshed ${String(refreshed)} conversation summaries (${String(failed)} failed; rerun to retry).`,
  )
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
