import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyGrafanaFailure, summarizeGrafanaBody } from './grafanaProxyError.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

const DS_QUERY_BODY = JSON.stringify({
  results: {
    A: {
      status: 200,
      frames: [
        {
          schema: { name: '{metric_model="qwen"}', refId: 'A', fields: [] },
          data: { values: [[1785577646858], [42518]] },
        },
      ],
    },
    C: { status: 400, error: '1:9: parse error: unexpected identifier "by"' },
  },
})

test('a /api/ds/query multi-status body is handed to the caller, not turned into a message', () => {
  const failure = classifyGrafanaFailure(400, DS_QUERY_BODY)

  assert.equal(failure.kind, 'query-results')
  assert.deepEqual(
    failure.kind === 'query-results' ? failure.body : null,
    JSON.parse(DS_QUERY_BODY),
  )
})

test('a Nuphos-shaped error body keeps its message', () => {
  const failure = classifyGrafanaFailure(
    502,
    JSON.stringify({
      error: { code: 'grafana_unreachable', message: 'Failed to reach Grafana: timeout' },
    }),
  )

  assert.deepEqual(failure, { kind: 'error', message: 'Failed to reach Grafana: timeout' })
})

test('a Grafana-shaped error body keeps its message', () => {
  const failure = classifyGrafanaFailure(404, JSON.stringify({ message: 'Dashboard not found' }))

  assert.deepEqual(failure, { kind: 'error', message: 'Dashboard not found' })
})

test('a JSON body with no message never leaks into the message', () => {
  const body = JSON.stringify({ traceID: 'abc', data: { series: [1, 2, 3] } })

  assert.deepEqual(classifyGrafanaFailure(500, body), { kind: 'error', message: 'HTTP 500' })
})

test('an empty results map is not mistaken for a query response', () => {
  assert.deepEqual(classifyGrafanaFailure(400, JSON.stringify({ results: {} })), {
    kind: 'error',
    message: 'HTTP 400',
  })
})

test('a plain-text gateway body is kept, an HTML one is not', () => {
  assert.deepEqual(classifyGrafanaFailure(502, 'upstream connect error'), {
    kind: 'error',
    message: 'HTTP 502: upstream connect error',
  })
  assert.deepEqual(classifyGrafanaFailure(502, '<html><body>Bad Gateway</body></html>'), {
    kind: 'error',
    message: 'HTTP 502',
  })
})

test('a message is clamped rather than shipped at any length', () => {
  const failure = classifyGrafanaFailure(500, JSON.stringify({ message: 'x'.repeat(5000) }))

  assert.equal(failure.kind, 'error')
  assert.ok(failure.kind === 'error' && failure.message.length <= 300)
})

test('an unparseable body falls back to the status alone', () => {
  assert.deepEqual(classifyGrafanaFailure(400, '{"results": {truncated'), {
    kind: 'error',
    message: 'HTTP 400',
  })
})

test('a body summary carries shape and size, never a value', () => {
  const body = JSON.stringify({
    traceID: 'abc',
    datasource: { url: 'postgres://admin:hunter2@db.internal:5432/metrics' },
    query: 'sum(rate({app="api", token="s3cr3t"}[5m]))',
  })
  const summary = summarizeGrafanaBody(500, body)

  assert.equal(summary.status, 500)
  assert.equal(summary.bytes, body.length)
  assert.equal(summary.shape, 'json-object')
  assert.deepEqual(summary.keys, ['traceID', 'datasource', 'query'])

  const serialized = JSON.stringify(summary)

  for (const secret of ['hunter2', 'db.internal', 's3cr3t', 'rate(', 'postgres://']) {
    assert.ok(!serialized.includes(secret), `summary leaked ${secret}`)
  }
})

test('a body summary reports shape without parsing values out of it', () => {
  assert.equal(summarizeGrafanaBody(502, '').shape, 'empty')
  assert.equal(summarizeGrafanaBody(502, '   ').shape, 'empty')
  assert.equal(summarizeGrafanaBody(502, '<html><body>Bad Gateway</body></html>').shape, 'markup')
  assert.equal(summarizeGrafanaBody(502, 'upstream connect error').shape, 'text')
  assert.equal(summarizeGrafanaBody(400, '[1, 2, 3]').shape, 'json-array')
  assert.equal(summarizeGrafanaBody(400, '{"a": 1}').shape, 'json-object')
  assert.equal(summarizeGrafanaBody(400, '{"results": {truncated').shape, 'text')
})

test('only object bodies contribute keys', () => {
  assert.equal(summarizeGrafanaBody(502, 'upstream connect error').keys, undefined)
  assert.equal(summarizeGrafanaBody(400, '[{"a": 1}]').keys, undefined)
})

test('keys are capped in count and length so a body cannot be reassembled from them', () => {
  const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]))

  assert.equal(summarizeGrafanaBody(500, JSON.stringify(wide)).keys?.length, 12)

  const longKey = 'x'.repeat(500)
  const keys = summarizeGrafanaBody(500, JSON.stringify({ [longKey]: 1 })).keys ?? []

  assert.equal(keys.length, 1)
  assert.ok(keys[0] !== undefined && keys[0].length <= 41)
})
