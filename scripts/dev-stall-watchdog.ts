// A service that has not reached 'ready' by these marks is reported on, with
// whatever evidence exists (last plain-text line, missing health milestones).
// The first mark sits well clear of a healthy backend cold start.
import { markDirty, pushEvent } from './dev-event-log.ts'
import { services } from './dev-services.ts'

import type { Service } from './dev-services.ts'

const STALL_MARKS_MS = [45_000, 120_000]

function stallSuspects(s: Service): string {
  if (s.name === 'runtime')
    return 'container up but not answering yet (emulated boot is slow; see bun run dev:logs runtime)'
  if (s.name !== 'backend') return ''
  const missing: string[] = []

  if (!s.health.mongo) missing.push('mongo not connected (is the docker compose stack up?)')
  else if (s.health.indexes === 'building…') missing.push('still building indexes')
  // Reached when every dependency looks healthy but the readiness event never
  // arrived — without this the watchdog would report a stall with no cause.
  else missing.push('server not listening yet')

  return missing.join(', ')
}

// Runs on the render tick. Emits at most one event per threshold per start, so
// a genuinely slow boot is not spammed but a hung one cannot stay silent.
export function checkStalls() {
  for (const s of services) {
    if (s.status !== 'starting' || s.startedAt == null) continue
    const elapsed = Date.now() - s.startedAt

    for (let i = s.stallNoticed; i < STALL_MARKS_MS.length; i++) {
      if (elapsed < STALL_MARKS_MS[i]!) break
      s.stallNoticed = i + 1
      const secs = Math.round(elapsed / 1000)
      const suspects = stallSuspects(s)
      const why = suspects ? ` — ${suspects}` : ''

      pushEvent(s, `still not ready after ${secs}s${why}`)
      if (s.lastRaw) pushEvent(s, `last output: ${s.lastRaw.slice(0, 160)}`)
      else pushEvent(s, `no output yet — see ${s.logPath}`)
      markDirty()
    }
  }
}
