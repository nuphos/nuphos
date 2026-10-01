import assert from 'node:assert/strict'
import { test } from 'node:test'

import { queryErrorText } from './errorText.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

const MAX_SUMMARY = 180

function dsQueryBody(): string {
  return JSON.stringify({
    results: {
      A: {
        status: 200,
        frames: Array.from({ length: 40 }, (_, i) => ({
          schema: {
            name: `{metric_model="model-${i}"}`,
            refId: 'A',
            meta: { typeVersion: [0, 0], custom: { resultType: 'vector' } },
            fields: [
              { name: 'Time', type: 'time' },
              { name: 'Value', type: 'number', labels: { metric_model: `model-${i}` } },
            ],
          },
          data: { values: [[1785577646858], [42518]] },
        })),
      },
      C: {
        status: 400,
        error: '1:9: parse error: unexpected identifier "by"',
      },
    },
  })
}

test('a Grafana multi-result body summarizes to the failing query, never the payload', () => {
  const body = dsQueryBody()
  const { summary, detail } = queryErrorText(body)

  assert.equal(summary, 'Query C failed: 1:9: parse error: unexpected identifier "by"')
  assert.ok(!summary.includes('metric_model'))
  assert.equal(detail, body)
})

test('a payload with no error text anywhere never reaches the summary', () => {
  const body = JSON.stringify({ results: { A: { status: 200, frames: [{ schema: {} }] } } })
  const { summary, detail } = queryErrorText(body)

  assert.ok(!summary.includes('{'))
  assert.ok(summary.length <= MAX_SUMMARY)
  assert.equal(detail, body)
})

test('the Electron IPC wrapper and Error prefix are stripped', () => {
  const { summary, detail } = queryErrorText(
    "Error invoking remote method 'atlas:grafanaProxy': Error: Datasource abc was not found",
  )

  assert.equal(summary, 'Datasource abc was not found')
  assert.equal(detail, null)
})

test('a Nuphos-shaped error body reads its message', () => {
  const { summary } = queryErrorText(
    JSON.stringify({ error: { code: 'grafana_unreachable', message: 'Failed to reach Grafana' } }),
  )

  assert.equal(summary, 'Failed to reach Grafana')
})

test('a Grafana-shaped error body reads its message', () => {
  const { summary } = queryErrorText(JSON.stringify({ message: 'Dashboard not found' }))

  assert.equal(summary, 'Dashboard not found')
})

test('a short plain message is shown verbatim with no details', () => {
  const { summary, detail } = queryErrorText('Not signed in')

  assert.equal(summary, 'Not signed in')
  assert.equal(detail, null)
})

test('a long plain message is clamped and the full text kept for details', () => {
  const long = `HTTP 500: ${'the upstream is very unhappy '.repeat(40)}`
  const { summary, detail } = queryErrorText(long)

  assert.ok(summary.length <= MAX_SUMMARY)
  assert.ok(summary.endsWith('…'))
  assert.equal(detail, long.trim())
})

test('a message that merely embeds a payload is not shown raw', () => {
  const { summary, detail } = queryErrorText(`HTTP 400: ${dsQueryBody()}`)

  assert.ok(!summary.includes('metric_model'))
  assert.ok(!summary.includes('{"'))
  assert.ok(detail !== null && detail.includes('metric_model'))
})

test('only the first line of a multi-line message becomes the summary', () => {
  const { summary, detail } = queryErrorText('Query failed\n  at parse (grafana.ts:1:1)')

  assert.equal(summary, 'Query failed')
  assert.equal(detail, 'Query failed\n  at parse (grafana.ts:1:1)')
})

test('an empty message still yields a readable summary', () => {
  assert.deepEqual(queryErrorText('   '), { summary: 'Request failed.', detail: null })
})
