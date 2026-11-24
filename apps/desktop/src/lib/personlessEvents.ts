import type { CaptureResult } from 'posthog-js'

// Debugging telemetry that fires several times per turn skips person
// processing, which PostHog bills per event. posthog-js overwrites
// `$process_person_profile` while building each event, so it is set in
// before_send, which runs after that.
const PERSONLESS_EVENTS = new Set([
  'agent_stream_end_decided',
  'agent_end_effects_deferred',
  'agent_end_effects_drained',
])

export function skipPersonProcessing(event: CaptureResult | null): CaptureResult | null {
  if (event && PERSONLESS_EVENTS.has(event.event)) event.properties.$process_person_profile = false

  return event
}
