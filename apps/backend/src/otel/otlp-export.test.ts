// Guards the patches/@opentelemetry%2Fotlp-exporter-base patch: Bun emits the
// request 'close' event before the response 'end' event (Node emits it after),
// which made the unpatched transport report every successful OTLP export as
// "Request timed out" (prod incident forensics). If a dependency bump changes
// the otlp-exporter-base version, bun silently stops applying the version-keyed
// patch — this test catches that regression.
import http from 'node:http'

import { ExportResultCode } from '@opentelemetry/core'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { afterAll, expect, test } from 'bun:test'

import type { ExportResult } from '@opentelemetry/core'
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics'
import type { AddressInfo } from 'node:net'

const servers: http.Server[] = []

function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler)

  servers.push(server)

  return new Promise((resolve) =>
    server.listen(0, () => resolve((server.address() as AddressInfo).port)),
  )
}

afterAll(() => {
  for (const server of servers) server.close()
})

async function exportOnce(url: string, timeoutMillis: number): Promise<ExportResult> {
  const results: ExportResult[] = []
  const delegate = new OTLPMetricExporter({ url, timeoutMillis })
  const observed: PushMetricExporter = {
    export: (metrics, callback) =>
      delegate.export(metrics, (result) => {
        results.push(result)
        callback(result)
      }),
    forceFlush: () => delegate.forceFlush(),
    shutdown: () => delegate.shutdown(),
    selectAggregationTemporality: delegate.selectAggregationTemporality?.bind(delegate),
  }
  const provider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: observed,
        exportIntervalMillis: 60_000,
        exportTimeoutMillis: timeoutMillis + 1_500,
      }),
    ],
  })

  provider.getMeter('otlp-export-test').createCounter('test.counter').add(1)
  await provider.forceFlush().catch(() => {})
  // The patched failure path is deferred one macrotask; give it time to land
  // so a bogus late failure can't hide behind the assertion.
  await new Promise((resolve) => setTimeout(resolve, 150))
  await provider.shutdown().catch(() => {})
  expect(results.length).toBeGreaterThan(0)

  return results[0]!
}

test('successful OTLP export reports success despite Bun close-before-end ordering', async () => {
  let received = 0
  const port = await listen((req, res) => {
    req.resume()
    req.on('end', () => {
      received++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"partialSuccess":{}}')
    })
  })
  const result = await exportOnce(`http://127.0.0.1:${String(port)}/v1/metrics`, 2_000)

  expect(result.code).toBe(ExportResultCode.SUCCESS)
  expect(received).toBeGreaterThan(0)
})

test('unreachable endpoint still reports failure', async () => {
  const result = await exportOnce('http://127.0.0.1:1/v1/metrics', 2_000)

  expect(result.code).toBe(ExportResultCode.FAILED)
})

test('endpoint that never responds still reports timeout failure', async () => {
  const port = await listen(() => {})
  const result = await exportOnce(`http://127.0.0.1:${String(port)}/v1/metrics`, 500)

  expect(result.code).toBe(ExportResultCode.FAILED)
})
