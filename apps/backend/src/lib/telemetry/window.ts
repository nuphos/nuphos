import { randomInt } from 'node:crypto'

import TELEMETRY_EVENTS from './events.json'

// Counts what logEvent() sees between two health reports. It only keeps numbers
// and an in-memory set of user ids for the active-user count; the ids never
// leave this module. Nothing is recorded until telemetry is switched on.

const ALLOWED_EVENTS = new Set(TELEMETRY_EVENTS)
const MAX_LATENCY_SAMPLES = 10_000

export type TelemetryWindow = {
  events: Record<string, number>
  activeUsers: number
  api: {
    requests: number
    errors4xx: number
    errors5xx: number
    latencyP50Ms: number
    latencyP95Ms: number
    latencyP99Ms: number
  }
}

let recording = false
let events = new Map<string, number>()
let users = new Set<string>()
let requests = 0
let errors4xx = 0
let errors5xx = 0
let latencies: number[] = []

export function setTelemetryRecording(on: boolean): void {
  recording = on
  takeTelemetryWindow()
}

export function recordTelemetryEvent(event: string, properties?: Record<string, unknown>): void {
  if (!recording) return
  if (ALLOWED_EVENTS.has(event)) events.set(event, (events.get(event) ?? 0) + 1)
  if (event === 'http.request' && properties) recordRequest(properties)
}

function recordRequest({
  path,
  status,
  duration_ms: ms,
  user_id: userId,
}: Record<string, unknown>) {
  // Readiness probes would drown real traffic in the rates.
  if (typeof path === 'string' && path.startsWith('/health')) return
  requests++
  if (typeof status === 'number' && status >= 500) errors5xx++
  else if (typeof status === 'number' && status >= 400) errors4xx++
  if (typeof userId === 'string') users.add(userId)
  if (typeof ms !== 'number') return
  // Reservoir sampling keeps the percentiles honest under heavy traffic.
  if (latencies.length < MAX_LATENCY_SAMPLES) latencies.push(ms)
  else {
    const slot = randomInt(requests)

    if (slot < MAX_LATENCY_SAMPLES) latencies[slot] = ms
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
}

/** Returns the counts gathered since the last call and starts a new window. */
export function takeTelemetryWindow(): TelemetryWindow {
  const sorted = latencies.toSorted((a, b) => a - b)
  const window: TelemetryWindow = {
    events: Object.fromEntries(events),
    activeUsers: users.size,
    api: {
      requests,
      errors4xx,
      errors5xx,
      latencyP50Ms: percentile(sorted, 0.5),
      latencyP95Ms: percentile(sorted, 0.95),
      latencyP99Ms: percentile(sorted, 0.99),
    },
  }

  events = new Map()
  users = new Set()
  requests = 0
  errors4xx = 0
  errors5xx = 0
  latencies = []

  return window
}
