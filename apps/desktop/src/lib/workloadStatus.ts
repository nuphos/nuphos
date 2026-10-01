// Shared workload "phase" classification used by BOTH the Cluster Overview
// status cards (to count rows per phase) and the resource list views (to
// resolve `status=<phase>` filters). Computing it in one place is what keeps
// "22 Running" on the overview consistent with what the Pods list shows once
// you click it through to `status=Running`.

import type {
  CronJobItem,
  DaemonSetItem,
  DeploymentItem,
  JobItem,
  NodeItem,
  PersistentVolumeItem,
  PodItem,
  ReplicaSetItem,
  StatefulSetItem,
} from '../types'

export type Tone = 'success' | 'warning' | 'error' | 'neutral'

export function toneTextClass(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'text-success'
    case 'warning':
      return 'text-warning'
    case 'error':
      return 'text-error'
    case 'neutral':
    default:
      return 'text-secondary'
  }
}

export function toneBgClass(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'bg-success'
    case 'warning':
      return 'bg-warning'
    case 'error':
      return 'bg-error'
    case 'neutral':
    default:
      return 'bg-zGray-600'
  }
}

const TONE_BY_LABEL: Record<string, Tone> = {
  running: 'success',
  ready: 'success',
  bound: 'success',
  available: 'success',
  active: 'success',
  scheduled: 'success',
  completed: 'neutral',
  succeeded: 'neutral',
  complete: 'neutral',
  idle: 'neutral',
  suspended: 'neutral',
  paused: 'neutral',
  progressing: 'warning',
  pending: 'warning',
  released: 'warning',
  failed: 'error',
  error: 'error',
  notready: 'error',
  lost: 'error',
}

export function toneForPhase(label: string): Tone {
  return TONE_BY_LABEL[label.toLowerCase()] ?? 'neutral'
}

// Order phases so the "healthy" ones lead each card, matching Aptakube.
const PHASE_RANK: Record<string, number> = {
  running: 0,
  ready: 0,
  bound: 0,
  scheduled: 0,
  active: 0,
  available: 1,
  progressing: 2,
  pending: 2,
  completed: 3,
  complete: 3,
  succeeded: 3,
  idle: 4,
  suspended: 4,
  paused: 4,
  released: 5,
  failed: 6,
  error: 6,
  notready: 6,
  lost: 6,
}

function phaseRank(label: string): number {
  return PHASE_RANK[label.toLowerCase()] ?? 5
}

function parseReady(ready: string): { ready: number; desired: number } {
  const [r, d] = ready.split('/')

  return { ready: Number.parseInt(r ?? '0', 10) || 0, desired: Number.parseInt(d ?? '0', 10) || 0 }
}

// A scaled-to-zero workload is "Idle"; fully-ready is "Running"; anything in
// between is still rolling out → "Progressing".
function replicaPhase(ready: number, desired: number): string {
  if (desired === 0) return 'Idle'
  if (ready >= desired) return 'Running'

  return 'Progressing'
}

export function podPhase(p: PodItem): string {
  const s = p.status.toLowerCase()

  if (s === 'running') return 'Running'
  if (s === 'completed' || s === 'succeeded') return 'Completed'
  if (s.includes('error') || s.includes('crash') || s.includes('fail') || s.includes('backoff'))
    return 'Failed'
  if (
    s.includes('pending') ||
    s.includes('creating') ||
    s.includes('waiting') ||
    s.includes('init')
  )
    return 'Pending'

  // Terminating / Unknown / anything else: surface verbatim.
  return p.status
}

export function deploymentPhase(d: DeploymentItem): string {
  const { ready, desired } = parseReady(d.ready)

  return replicaPhase(ready, desired)
}

export function statefulSetPhase(s: StatefulSetItem): string {
  const { ready, desired } = parseReady(s.ready)

  return replicaPhase(ready, desired)
}

export function replicaSetPhase(r: ReplicaSetItem): string {
  return replicaPhase(r.ready, r.desired)
}

export function daemonSetPhase(d: DaemonSetItem): string {
  return replicaPhase(d.ready, d.desired)
}

export function jobPhase(j: JobItem): string {
  const s = j.status.toLowerCase()

  if (s.includes('complete') || s === 'succeeded') return 'Completed'
  if (s.includes('fail')) return 'Failed'
  if (s.includes('run') || s.includes('active')) return 'Running'

  return j.status
}

export function cronJobPhase(c: CronJobItem): string {
  return c.suspend ? 'Suspended' : 'Scheduled'
}

export function nodePhase(n: NodeItem): string {
  return n.status
}

export function pvPhase(pv: PersistentVolumeItem): string {
  return pv.status
}

export type PhaseCount = { label: string; count: number; tone: Tone }

// Group rows by phase into an ordered, colour-tagged breakdown for a card.
export function summarizePhases<T>(rows: T[], phase: (row: T) => string): PhaseCount[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const label = phase(row)

    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, tone: toneForPhase(label) }))
    .sort(
      (a, b) =>
        phaseRank(a.label) - phaseRank(b.label) ||
        b.count - a.count ||
        a.label.localeCompare(b.label),
    )
}
