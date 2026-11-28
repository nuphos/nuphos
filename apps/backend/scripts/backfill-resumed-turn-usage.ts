/**
 * Correct Claude turns recorded with the running total Claude Code restored on
 * resume (#5203), using src/lib/agent/resumed-turn-usage-backfill.ts.
 *
 * DRY RUN BY DEFAULT — it writes nothing unless you pass --apply.
 *
 *   bun run scripts/backfill-resumed-turn-usage.ts --from 2026-11-17 --out ./report
 *   bun run scripts/backfill-resumed-turn-usage.ts --from 2026-11-17 --apply --refresh-summaries
 *
 * Flags:
 *   --from <ISO>          inclusive lower bound on createdAt (required)
 *   --to <ISO>            exclusive upper bound (default: now)
 *   --out <dir>           write decisions.csv, manual.csv and sessions.csv there
 *   --apply               actually write (otherwise: report only)
 *   --refresh-summaries   with --apply, rebuild each corrected conversation's summary
 *
 * Sessions are read one at a time. With --apply, each session's rows change in
 * one transaction. A corrected row keeps its recorded tokens in
 * `resumedUsageCorrection.original`: that is the backup, the rollback source, and
 * what makes a rerun leave it alone. Only tokens change. Rows of a turn are never
 * deleted, and a row the decision layer cannot explain is reported, not written.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  applyResumedTurnCorrections,
  CORRECTED_FIELDS,
  RESUMED_TURN_ROWS,
  resumedTurnDecisions,
} from '@/lib/agent/resumed-turn-usage-backfill'
import { agentTokenUsage } from '@/lib/agent/token-usage-db'
import { refreshConversationTokenUsageSummary } from '@/lib/agent/token-usage-summary'
import { closeDb, connectDb } from '@/lib/db'

import type { Counts, ResumedUsageDecision } from '@/lib/agent/resumed-turn-usage-backfill'

function flagValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)

  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function date(name: string, fallback?: Date): Date {
  const raw = flagValue(name)

  if (!raw && fallback) return fallback
  const value = new Date(raw ?? Number.NaN)

  if (Number.isNaN(value.getTime()))
    fail(`--${name} <ISO timestamp> must parse as a date (got: ${raw})`)

  return value
}

const csv = (rows: (string | number)[][]): string => `${rows.map((r) => r.join(',')).join('\n')}\n`
const values = (c?: Counts): number[] => CORRECTED_FIELDS.map((f) => c?.[f] ?? '') as number[]

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const refresh = process.argv.includes('--refresh-summaries')
  const from = date('from')
  const to = date('to', new Date())
  const out = flagValue('out')

  if (from >= to) fail(`--from must be before --to`)
  if (refresh && !apply) fail('--refresh-summaries only makes sense with --apply')

  await connectDb()
  const window = { ...RESUMED_TURN_ROWS, kind: 'step_total', createdAt: { $gte: from, $lt: to } }
  const sessionIds = await agentTokenUsage().distinct('sessionId', {
    ...window,
    'tokens.inputTokens': { $gt: 10_000_000 },
  })
  const decisionRows: (string | number)[][] = []
  const manualRows: (string | number)[][] = []
  const sessionRows: (string | number)[][] = []
  const total = { rows: 0, sessions: 0, manual: 0, before: [0, 0], after: [0, 0] }

  for (const sessionId of sessionIds) {
    const rows = await agentTokenUsage()
      .find({ ...window, sessionId })
      .project<{
        recordId: string
        userId: string
        teamId?: string
        modelId: string
        createdAt: Date
        tokens: Counts
        resumedUsageCorrection?: { original: Counts }
      }>({
        _id: 0,
        recordId: 1,
        userId: 1,
        teamId: 1,
        modelId: 1,
        createdAt: 1,
        tokens: 1,
        resumedUsageCorrection: 1,
      })
      .toArray()
    const decisions = resumedTurnDecisions(
      rows.map((r) => ({ ...r, original: r.resumedUsageCorrection?.original })),
    )
    const corrections = decisions.filter((d) => d.action === 'correct')
    const sum = { before: [0, 0], after: [0, 0] }

    for (const d of decisions) {
      const after = d.action === 'correct' ? d.after : d.before
      const row = [sessionId, d.modelId, d.createdAt.toISOString(), d.recordId]

      if (d.action === 'already_corrected') continue
      sum.before[0] += d.before.inputTokens
      sum.before[1] += d.before.outputTokens
      sum.after[0] += after.inputTokens
      sum.after[1] += after.outputTokens
      if (d.action === 'correct')
        decisionRows.push([...row, d.method, ...values(d.before), ...values(d.after)])
      else
        manualRows.push([
          ...row,
          d.reason.split(':')[0],
          ...values(d.before),
          ...values(d.suggested),
        ])
    }
    if (apply && corrections.length > 0) await applyResumedTurnCorrections(sessionId, decisions)
    // Also for a session an interrupted run corrected but did not refresh.
    if (refresh && decisions.some((d) => d.action !== 'manual'))
      await refreshConversationTokenUsageSummary(sessionId, rows[0].userId, rows[0].teamId)
    if (decisions.every((d) => d.action === 'already_corrected')) continue
    total.sessions++
    total.rows += corrections.length
    total.manual += decisions.filter((d) => d.action === 'manual').length
    for (const i of [0, 1]) {
      total.before[i] += sum.before[i]
      total.after[i] += sum.after[i]
    }
    sessionRows.push([sessionId, corrections.length, ...sum.before, ...sum.after])
  }

  if (out) {
    const fields = (prefix: string) => CORRECTED_FIELDS.map((f) => `${prefix}_${f}`)
    const key = ['sessionId', 'modelId', 'createdAt', 'recordId']

    mkdirSync(out, { recursive: true })
    writeFileSync(
      join(out, 'decisions.csv'),
      csv([[...key, 'method', ...fields('before'), ...fields('after')], ...decisionRows]),
    )
    writeFileSync(
      join(out, 'manual.csv'),
      csv([[...key, 'reason', ...fields('before'), ...fields('suggested')], ...manualRows]),
    )
    writeFileSync(
      join(out, 'sessions.csv'),
      csv([
        ['sessionId', 'corrected', 'inputBefore', 'outputBefore', 'inputAfter', 'outputAfter'],
        ...sessionRows,
      ]),
    )
  }
  console.log(
    JSON.stringify({
      mode: apply ? 'APPLY' : 'DRY RUN',
      from,
      to,
      candidateSessions: sessionIds.length,
      ...total,
    }),
  )
  await closeDb()
}

await main()
