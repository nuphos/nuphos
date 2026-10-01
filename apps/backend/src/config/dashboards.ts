import { boundedInt } from './env'
import { modelId } from './model'

const EXEC_TIMEOUT_BOUNDS = { min: 5_000, max: 300_000 }
const MAX_OUTPUT_BOUNDS = { min: 4_096, max: 8 * 1024 * 1024 }
const SNAPSHOT_FRESH_BOUNDS = { min: 0, max: 3_600_000 }
const SNAPSHOT_TTL_BOUNDS = { min: 30, max: 3650 }

// Dashboards: script-driven live panels. Each panel's JS runs on one of the
// team's agent runtimes and emits a validated snapshot. See
// routes/dashboards.ts + lib/dashboards/*.
//
// Each COST_PANEL_* key is a deprecated alias of its DASHBOARD_PANEL_* key,
// read only when the new one is unset.
export function dashboardsConfig() {
  return {
    // Provider APIs commonly paginate or fan out across regions. Give a panel
    // five minutes by default while retaining a bounded hard cap.
    execTimeoutMs: boundedInt(
      'DASHBOARD_PANEL_EXEC_TIMEOUT_MS',
      boundedInt('COST_PANEL_EXEC_TIMEOUT_MS', 300_000, EXEC_TIMEOUT_BOUNDS),
      EXEC_TIMEOUT_BOUNDS,
    ),
    // Max stdout bytes accepted from a panel run before parsing (DoS guard).
    maxOutputBytes: boundedInt(
      'DASHBOARD_PANEL_MAX_OUTPUT_BYTES',
      boundedInt('COST_PANEL_MAX_OUTPUT_BYTES', 512 * 1024, MAX_OUTPUT_BOUNDS),
      MAX_OUTPUT_BOUNDS,
    ),
    // Optional max-age cap on reusing an immutable snapshot with the same
    // script+params. 0 (default) = reuse indefinitely, since a snapshot is
    // deterministic for its (version, params incl. time window); set a positive
    // cap only to force periodic re-runs of otherwise-identical requests. An
    // explicit force refresh / cadence run always bypasses reuse.
    snapshotFreshMs: boundedInt(
      'DASHBOARD_PANEL_SNAPSHOT_FRESH_MS',
      boundedInt('COST_PANEL_SNAPSHOT_FRESH_MS', 0, SNAPSHOT_FRESH_BOUNDS),
      SNAPSHOT_FRESH_BOUNDS,
    ),
    // Snapshot TTL (days); each snapshot ages out at its own createdAt + this
    // window (per-document expiresAt TTL index).
    snapshotTtlDays: boundedInt(
      'DASHBOARD_PANEL_SNAPSHOT_TTL_DAYS',
      boundedInt('COST_PANEL_SNAPSHOT_TTL_DAYS', 400, SNAPSHOT_TTL_BOUNDS),
      SNAPSHOT_TTL_BOUNDS,
    ),
    // Model for the separate Insight pass. Empty falls back to the agent model.
    insightModel: modelId('DASHBOARD_PANEL_INSIGHT_MODEL') ?? modelId('COST_PANEL_INSIGHT_MODEL'),
  }
}
