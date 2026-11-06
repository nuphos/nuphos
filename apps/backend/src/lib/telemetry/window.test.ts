import { afterEach, describe, expect, test } from 'bun:test'

import { recordTelemetryEvent, setTelemetryRecording, takeTelemetryWindow } from './window'

afterEach(() => setTelemetryRecording(false))

describe('telemetry window', () => {
  test('records nothing until telemetry is switched on', () => {
    recordTelemetryEvent('http.request', { path: '/teams', status: 500, duration_ms: 3 })

    expect(takeTelemetryWindow()).toMatchObject({ events: {}, api: { requests: 0 } })
  })

  test('counts only allowlisted event names', () => {
    setTelemetryRecording(true)
    recordTelemetryEvent('agent.local_runtime.tunnel_opened')
    recordTelemetryEvent('agent.local_runtime.tunnel_opened')
    recordTelemetryEvent('user@example.com')

    expect(takeTelemetryWindow().events).toEqual({ 'agent.local_runtime.tunnel_opened': 2 })
  })

  test('turns requests into rates, percentiles and an active-user count without keeping ids', () => {
    setTelemetryRecording(true)
    for (const [status, ms, user] of [
      [200, 10, 'user-a'],
      [404, 20, 'user-a'],
      [500, 30, 'user-b'],
      [200, 40, undefined],
    ] as const) {
      recordTelemetryEvent('http.request', {
        path: '/teams/x',
        status,
        duration_ms: ms,
        user_id: user,
      })
    }
    recordTelemetryEvent('http.request', { path: '/health/ready', status: 200, duration_ms: 1 })
    const window = takeTelemetryWindow()

    expect(window.api).toEqual({
      requests: 4,
      errors4xx: 1,
      errors5xx: 1,
      latencyP50Ms: 30,
      latencyP95Ms: 40,
      latencyP99Ms: 40,
    })
    expect(window.activeUsers).toBe(2)
    expect(JSON.stringify(window)).not.toContain('user-a')
    expect(takeTelemetryWindow().api.requests).toBe(0)
  })
})
