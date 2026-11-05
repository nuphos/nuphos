import type { DashboardPanel, DashboardPanelOutput } from '../../../dashboards/schema'

/** What the latest read of a pinned panel's dashboard returned. */
export type PanelRead =
  | { status: 'ok'; dashboardName: string; panel: DashboardPanel | null }
  /** The dashboard itself was deleted. */
  | { status: 'not_found' }
  /** Offline, a server error or a refused read: a later read can still succeed. */
  | { status: 'error' }

/** Why a panel that still exists has nothing to draw. */
export type EmptyReason = 'running' | 'failed' | 'never_run' | 'no_output'

export type PanelCardBody =
  | { kind: 'loading' }
  /** The panel or its dashboard was deleted; the pin can never show anything again. */
  | { kind: 'gone' }
  | { kind: 'unreachable' }
  | { kind: 'output'; output: DashboardPanelOutput }
  | { kind: 'empty'; reason: EmptyReason }

export function lastOutput(panel: DashboardPanel): DashboardPanelOutput | null {
  const snapshot =
    panel.lastSuccessfulSnapshot ??
    (panel.currentSnapshot?.status === 'complete' ? panel.currentSnapshot : null)

  return snapshot?.output ?? null
}

function emptyReason(panel: DashboardPanel): EmptyReason {
  const current = panel.currentSnapshot

  if (current?.status === 'running') return 'running'
  if (current?.status === 'failed') return 'failed'
  if (!current && !panel.lastSuccessfulSnapshot) return 'never_run'

  return 'no_output'
}

/** A failed read keeps whatever was already showing. */
export function nextRead(prev: PanelRead | null, next: PanelRead): PanelRead {
  return next.status === 'error' && prev ? prev : next
}

export function panelCardBody(read: PanelRead | null): PanelCardBody {
  if (!read) return { kind: 'loading' }
  if (read.status === 'error') return { kind: 'unreachable' }
  if (read.status === 'not_found' || !read.panel) return { kind: 'gone' }
  const output = lastOutput(read.panel)

  if (output) return { kind: 'output', output }

  return { kind: 'empty', reason: emptyReason(read.panel) }
}
