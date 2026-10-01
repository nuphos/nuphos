import { createHash } from 'node:crypto'

import { dashboardPanelInsights } from '@/models'
import { normalizeCredentialSelection } from '@/routes/agent/team-scope'

import type {
  NuphosDashboard,
  DashboardPanel,
  DashboardPanelInsight,
  DashboardPanelScriptVersion,
  DashboardPanelSnapshot,
} from '@/models'
import type { ObjectId } from 'mongodb'

/** Append-only version history cap. Generous so a frozen snapshot can still
 *  resolve its script body by version for a long edit history. */
const MAX_SCRIPT_VERSIONS = 50

/**
 * Append a new script version when the code actually changed. Editing to
 * identical code is a no-op (returns null) so the version doesn't churn. Old
 * snapshots keep their own scriptVersion — this only advances the panel head.
 * Pure + exported so the version invariant is unit-testable without a DB.
 */
export function appendScriptVersion(
  versions: DashboardPanelScriptVersion[],
  scriptVersion: number,
  code: string,
  authoredBy: string,
  now: Date,
  maxVersions = MAX_SCRIPT_VERSIONS,
): { scriptVersion: number; versions: DashboardPanelScriptVersion[] } | null {
  const codeHash = createHash('sha256').update(code).digest('hex')
  const head = versions.find((v) => v.version === scriptVersion)

  if (head && head.codeHash === codeHash) return null
  const nextVersion = scriptVersion + 1
  const next = [
    ...versions,
    { version: nextVersion, code, codeHash, authoredBy, createdAt: now },
  ].slice(-maxVersions)

  return { scriptVersion: nextVersion, versions: next }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeDashboard(doc: NuphosDashboard) {
  return {
    id: doc._id.toHexString(),
    teamId: doc.teamId.toHexString(),
    name: doc.name,
    layout: doc.layout.map((l) => ({
      panelId: l.panelId.toHexString(),
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
    })),
    timeRange: {
      periodStart: doc.timeRange.periodStart.toISOString(),
      periodEnd: doc.timeRange.periodEnd.toISOString(),
      granularity: doc.timeRange.granularity ?? null,
    },
    rangePreset: doc.rangePreset ?? null,
    cadence: doc.cadence ?? null,
    nextRefreshAt: doc.nextRefreshAt?.toISOString() ?? null,
    lastScheduledRefreshAt: doc.lastScheduledRefreshAt?.toISOString() ?? null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function serializeSnapshot(doc: DashboardPanelSnapshot) {
  return {
    id: doc._id.toHexString(),
    panelId: doc.panelId.toHexString(),
    dashboardId: doc.dashboardId.toHexString(),
    scriptVersion: doc.scriptVersion,
    codeHash: doc.codeHash,
    params: doc.params,
    paramsHash: doc.paramsHash,
    requestedAt: doc.requestedAt.toISOString(),
    executedAt: doc.executedAt?.toISOString() ?? null,
    finishedAt: doc.finishedAt?.toISOString() ?? null,
    status: doc.status,
    output: doc.output ?? null,
    error: doc.error ? { message: doc.error.message, kind: doc.error.kind } : null,
    runtimeId: doc.runtimeId ?? null,
    sandboxId: doc.sandboxId ?? null,
    durationMs: doc.durationMs ?? null,
    createdAt: doc.createdAt.toISOString(),
  }
}

export function serializeInsight(doc: DashboardPanelInsight) {
  return {
    id: doc._id.toHexString(),
    panelId: doc.panelId.toHexString(),
    snapshotId: doc.snapshotId.toHexString(),
    scriptVersion: doc.scriptVersion,
    status: doc.status,
    findings: doc.findings,
    actions: doc.actions,
    feedback: doc.feedback
      ? { rating: doc.feedback.rating, note: doc.feedback.note ?? null }
      : null,
    generatedBy: doc.generatedBy,
    error: doc.error ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

/** Panel serialization. `currentSnapshot` is the resolved live-latest (or
 *  frozen) execution state, while `lastSuccessfulSnapshot` preserves the last
 *  known-good output across running/failed refreshes. `insightInfo` carries the
 *  latest Insight bound to the panel + whether it's stale (bound to an older
 *  snapshot). The full script bodies stay server-side; the client gets the head
 *  code + version metadata (it edits against the head). */
export function serializePanel(
  doc: DashboardPanel,
  dashboard: Pick<NuphosDashboard, 'cadence'>,
  currentSnapshot: DashboardPanelSnapshot | null,
  insightInfo?: { insight: DashboardPanelInsight | null; stale: boolean },
  lastSuccessfulSnapshot: DashboardPanelSnapshot | null = null,
) {
  const head = doc.versions.find((v) => v.version === doc.scriptVersion) ?? doc.versions.at(-1)

  return {
    id: doc._id.toHexString(),
    dashboardId: doc.dashboardId.toHexString(),
    title: doc.title,
    kind: doc.kind,
    scriptVersion: doc.scriptVersion,
    code: head?.code ?? '',
    versions: doc.versions.map((v) => ({
      version: v.version,
      codeHash: v.codeHash,
      authoredBy: v.authoredBy,
      createdAt: v.createdAt.toISOString(),
    })),
    staticParams: doc.staticParams ?? null,
    // Mirrors the dashboard's schedule for desktops that still edit it per panel.
    cadence: dashboard.cadence ?? null,
    credentialAccess: doc.credentialAccess
      ? normalizeCredentialSelection(doc.credentialAccess)
      : null,
    currentSnapshot: currentSnapshot ? serializeSnapshot(currentSnapshot) : null,
    lastSuccessfulSnapshot: lastSuccessfulSnapshot
      ? serializeSnapshot(lastSuccessfulSnapshot)
      : null,
    insight: insightInfo?.insight ? serializeInsight(insightInfo.insight) : null,
    insightStale: insightInfo?.stale ?? false,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Snapshot resolution (live-latest)
// ---------------------------------------------------------------------------

/** Batch-resolve the Insight to show per panel: the one bound to the panel's
 *  current snapshot (insights travel with snapshots), falling back to the newest
 *  — marked stale — when the current snapshot has none of its own. One query. */
export async function resolvePanelInsights(
  teamId: ObjectId,
  panels: DashboardPanel[],
  snapshots: Map<string, DashboardPanelSnapshot>,
): Promise<Map<string, { insight: DashboardPanelInsight | null; stale: boolean }>> {
  const out = new Map<string, { insight: DashboardPanelInsight | null; stale: boolean }>()

  if (!panels.length) return out
  const rows = await dashboardPanelInsights()
    .find({ teamId, panelId: { $in: panels.map((p) => p._id) } })
    .sort({ createdAt: -1 })
    .toArray()
  const byPanel = new Map<string, DashboardPanelInsight[]>()

  for (const row of rows) {
    const key = row.panelId.toHexString()
    const list = byPanel.get(key)

    if (list) list.push(row)
    else byPanel.set(key, [row])
  }
  for (const panel of panels) {
    const key = panel._id.toHexString()
    const list = byPanel.get(key) ?? []
    const currentId = snapshots.get(key)?._id
    const bound = currentId ? list.find((i) => i.snapshotId.equals(currentId)) : undefined
    const insight = bound ?? list[0] ?? null

    out.set(key, { insight, stale: !bound && Boolean(insight) })
  }

  return out
}
