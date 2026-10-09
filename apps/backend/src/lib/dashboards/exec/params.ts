import { createHash } from 'node:crypto'

import { ObjectId } from 'mongodb'

import { byCodeUnit } from '@/lib/agent/sort-order'
import { nuphosDashboards, dashboardPanelSnapshots } from '@/models'

import type {
  NuphosDashboard,
  DashboardPanel,
  DashboardPanelSnapshot,
  DashboardRangePreset,
  DashboardTimeRange,
} from '@/models'

// ---------------------------------------------------------------------------
// Rolling (relative) time ranges
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** Concrete window for a rolling preset, quantized to whole UTC days so it is
 *  stable within a day (identical params ⇒ snapshot reuse) yet steps forward
 *  once per day. */
export function presetWindow(
  preset: DashboardRangePreset,
  now = new Date(),
): { periodStart: Date; periodEnd: Date } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const endOfToday = new Date(Date.UTC(y, m, d, 23, 59, 59, 999))

  if (preset === 'thisMonth')
    return { periodStart: new Date(Date.UTC(y, m, 1)), periodEnd: endOfToday }
  if (preset === 'prevMonth') {
    // Day 0 of this month = last day of the previous month; include that whole day.
    return {
      periodStart: new Date(Date.UTC(y, m - 1, 1)),
      periodEnd: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
    }
  }

  // Rolling windows include today, so their start is N - 1 whole UTC days ago.
  const days = preset === 'last7' ? 7 : preset === 'last14' ? 14 : 30

  return {
    periodStart: new Date(Date.UTC(y, m, d) - (days - 1) * DAY_MS),
    periodEnd: endOfToday,
  }
}

/** Advance a saved rolling default before refresh. Compare-and-set prevents
 * concurrent preset, custom-range or granularity edits from being overwritten;
 * reload and retry when another writer wins. */
export async function advanceRelativeWindow(dashboard: NuphosDashboard): Promise<NuphosDashboard> {
  let current = dashboard

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!current.rangePreset) return current
    const { periodStart, periodEnd } = presetWindow(current.rangePreset)
    const cur = current.timeRange

    if (
      cur.periodStart.getTime() === periodStart.getTime() &&
      cur.periodEnd.getTime() === periodEnd.getTime()
    ) {
      return current
    }
    const timeRange: DashboardTimeRange = {
      periodStart,
      periodEnd,
      ...(cur.granularity ? { granularity: cur.granularity } : {}),
    }
    const updated = await nuphosDashboards().findOneAndUpdate(
      {
        _id: current._id,
        teamId: current.teamId,
        rangePreset: current.rangePreset,
        'timeRange.periodStart': cur.periodStart,
        'timeRange.periodEnd': cur.periodEnd,
        // Match granularity exactly, including its absence, so a granularity
        // change also fails the CAS.
        'timeRange.granularity': cur.granularity ?? { $exists: false },
      },
      { $set: { timeRange, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )

    if (updated) return updated
    // Lost the race to a concurrent edit — reload the authoritative doc and retry
    // against it rather than executing panels with stale parameters.
    const latest = await nuphosDashboards().findOne({ _id: current._id, teamId: current.teamId })

    if (!latest) return current
    current = latest
  }

  return (await nuphosDashboards().findOne({ _id: current._id, teamId: current.teamId })) ?? current
}

/** Merge the dashboard's authoritative timeRange with the panel's staticParams
 *  into a canonical, JSON-safe object plus a stable hash. The time window ALWAYS
 *  comes from the dashboard — panels never carry their own. Same script + same
 *  resolved params ⇒ same paramsHash ⇒ dedupable. */
export function resolveParams(
  dashboard: NuphosDashboard,
  panel: DashboardPanel,
): { params: Record<string, unknown>; paramsHash: string } {
  const merged: Record<string, unknown> = {
    // staticParams first so neither the dashboard time window nor teamId can be
    // shadowed by a panel-supplied key.
    ...(panel.staticParams ?? {}),
    // teamId is injected so scripts can build team-scoped Nuphos URLs
    // (e.g. `nuphos.get('/teams/'+params.teamId+'/aws-accounts/...')`) without
    // hard-coding it.
    teamId: dashboard.teamId.toHexString(),
    periodStart: dashboard.timeRange.periodStart.toISOString(),
    periodEnd: dashboard.timeRange.periodEnd.toISOString(),
    granularity: dashboard.timeRange.granularity ?? 'day',
  }
  const canonical = canonicalize(merged) as Record<string, unknown>
  const paramsHash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')

  return { params: canonical, paramsHash }
}

/** Deterministic key ordering so the hash is stable regardless of insertion
 *  order. Arrays keep order; objects sort keys recursively. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}

    for (const key of Object.keys(value).sort(byCodeUnit)) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }

    return out
  }

  return value
}

export function headCode(panel: DashboardPanel): {
  code: string
  codeHash: string
  version: number
  authoredBy: string
} {
  const head =
    panel.versions.find((candidate) => candidate.version === panel.scriptVersion) ??
    panel.versions.at(-1)

  if (!head) throw new Error('panel has no script version')

  return {
    code: head.code,
    codeHash: head.codeHash,
    version: head.version,
    authoredBy: head.authoredBy,
  }
}

export function panelExecutionPrincipal(panel: DashboardPanel, authoredBy: string): string {
  return ObjectId.isValid(authoredBy) ? authoredBy : panel.createdBy
}

/** The (codeHash, paramsHash) identifying the immutable snapshot a panel
 *  currently displays under the dashboard's time range — its head script version
 *  plus resolved params. Used to resolve which stored snapshot is "current" so
 *  switching to an already-computed range shows that range's snapshot. */
export function panelSnapshotKey(
  dashboard: NuphosDashboard,
  panel: DashboardPanel,
): { codeHash: string; paramsHash: string } {
  const { codeHash } = headCode(panel)
  const { paramsHash } = resolveParams(dashboard, panel)

  return { codeHash, paramsHash }
}

/** Resolve the snapshot each panel currently displays: the newest run (any
 *  status) matching the panel's CURRENT (script version, params) under the
 *  dashboard's time range. This binds the displayed snapshot to the current time
 *  window rather than "whatever ran most recently", so switching to an
 *  already-computed range shows that range's immutable snapshot and a bound
 *  insight reads as current instead of stale. Batch-loaded to avoid N+1 reads. */
export async function resolvePanelSnapshots(
  teamId: ObjectId,
  dashboard: NuphosDashboard,
  panels: DashboardPanel[],
): Promise<Map<string, DashboardPanelSnapshot>> {
  const out = new Map<string, DashboardPanelSnapshot>()
  // Each lookup follows the compound panel/script/params index and stops after
  // one document. A single `$or` + global sort must materialize every matching
  // historical snapshot (including large chart outputs) before choosing one,
  // which is especially slow against the remote Mongo used by local dev.

  await Promise.all(
    panels.map(async (panel) => {
      try {
        const { codeHash, paramsHash } = panelSnapshotKey(dashboard, panel)
        const row = await dashboardPanelSnapshots()
          .find({ teamId, panelId: panel._id, codeHash, paramsHash })
          .sort({ requestedAt: -1 })
          .limit(1)
          .next()

        if (row) out.set(panel._id.toHexString(), row)
      } catch {
        // Panel with no script version yet — nothing to display.
      }
    }),
  )

  return out
}

/** Older windows of the selected rolling preset that still overlap the view.
 * Hash the complete params so changes to static params or granularity never
 * inherit unrelated output. Month views never fall back across a month boundary.
 * At most 30 hashes, all served by the existing panel/script/params index. */
export function rollingSnapshotHashes(
  dashboard: NuphosDashboard,
  panel: DashboardPanel,
  preset?: DashboardRangePreset,
): string[] {
  if (!preset || preset === 'prevMonth') return []
  const { periodStart, periodEnd } = dashboard.timeRange
  const hashes: string[] = []

  for (let end = periodEnd.getTime() - DAY_MS; end >= periodStart.getTime(); end -= DAY_MS) {
    const timeRange = { ...dashboard.timeRange, ...presetWindow(preset, new Date(end)) }

    hashes.push(resolveParams({ ...dashboard, timeRange }, panel).paramsHash)
  }

  return hashes
}

/** Prefer an exact successful match. Rolling views may retain an earlier
 * overlapping window of the same preset, script and non-date params. Explicit
 * historical ranges stay exact; callers without a view retain legacy behavior. */
export async function resolveLastSuccessfulPanelSnapshots(
  teamId: ObjectId,
  panels: DashboardPanel[],
  dashboard?: NuphosDashboard,
  preset?: DashboardRangePreset,
): Promise<Map<string, DashboardPanelSnapshot>> {
  const out = new Map<string, DashboardPanelSnapshot>()

  if (!panels.length) return out
  await Promise.all(
    panels.map(async (panel) => {
      try {
        const { codeHash } = headCode(panel)
        let row = await dashboardPanelSnapshots()
          .find({
            teamId,
            panelId: panel._id,
            codeHash,
            ...(dashboard ? { paramsHash: resolveParams(dashboard, panel).paramsHash } : {}),
            status: 'complete',
            output: { $exists: true },
          })
          .sort({ requestedAt: -1 })
          .limit(1)
          .next()

        if (!row && dashboard) {
          const hashes = rollingSnapshotHashes(dashboard, panel, preset)

          if (hashes.length) {
            row = await dashboardPanelSnapshots()
              .find({
                teamId,
                panelId: panel._id,
                codeHash,
                paramsHash: { $in: hashes },
                status: 'complete',
                output: { $exists: true },
              })
              .sort({ 'params.periodEnd': -1, requestedAt: -1 })
              .limit(1)
              .next()
          }
        }
        if (row) out.set(panel._id.toHexString(), row)
      } catch {
        // Panel with no script version yet — nothing to preserve.
      }
    }),
  )

  return out
}
