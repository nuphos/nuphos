import { createHash } from 'node:crypto'

import { normalizeCredentialSelection } from '@/routes/agent/team-scope'

import type {
  NuphosDashboard,
  DashboardPanel,
  DashboardPanelScriptVersion,
  DashboardPanelSnapshot,
} from '@/models'

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

/** Panel serialization. `currentSnapshot` is the resolved live-latest (or
 *  frozen) execution state, while `lastSuccessfulSnapshot` preserves the last
 *  known-good output across running/failed refreshes. The full script bodies stay server-side; the client gets the head
 *  code + version metadata (it edits against the head). */
export function serializePanel(
  doc: DashboardPanel,
  dashboard: Pick<NuphosDashboard, 'cadence'>,
  currentSnapshot: DashboardPanelSnapshot | null,
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
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}
