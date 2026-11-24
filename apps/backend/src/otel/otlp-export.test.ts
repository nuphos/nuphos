// Bun emits the request 'close' event before the response 'end' event (Node
// emits it after). The 0.57 OTLP HTTP transport reported failure on 'close',
// so under Bun every successful export read as "Request timed out" (prod
// incident forensics), and a patch deferred it. The 0.2xx transport no longer
// listens for 'close', so the patch is gone; these tests keep a future
// exporter bump from bringing the bug back.
import http from 'node:http'
import { gunzipSync } from 'node:zlib'

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
  // A late failure would land a macrotask after the export; give it time
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

type OtlpValue = { stringValue?: string }
type OtlpResource = { attributes?: { key: string; value: OtlpValue }[] }
type OtlpBody = {
  resourceSpans?: { resource?: OtlpResource; scopeSpans?: { spans?: { name: string }[] }[] }[]
  resourceMetrics?: {
    resource?: OtlpResource
    scopeMetrics?: { metrics?: { name: string }[] }[]
  }[]
  resourceLogs?: {
    resource?: OtlpResource
    scopeLogs?: { logRecords?: { body?: OtlpValue }[] }[]
  }[]
}

test('the backend telemetry exports traces, metrics and logs to an OTLP collector', async () => {
  const bodies = new Map<string, OtlpBody[]>()
  const collector = await listen((req, res) => {
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const text = (req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString()

      bodies.set(req.url ?? '', [...(bodies.get(req.url ?? '') ?? []), JSON.parse(text)])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  })
  // The fetch instrumentation skips the collector's own origin, so the traced call goes elsewhere.
  const upstream = await listen((_req, res) => res.end('ok'))
  const endpoint = `http://127.0.0.1:${String(collector)}`
  // Its own process: startTelemetry installs global providers other suites must not inherit.
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `const { setupTelemetry } = await import(${JSON.stringify(`${import.meta.dir}/index.ts`)})
      const { logs } = await import('@opentelemetry/api-logs')
      const { shutdown } = await setupTelemetry()
      await fetch('http://127.0.0.1:${String(upstream)}/ping')
      logs.getLogger('otel-export-test').emit({ body: 'otel export test log' })
      await shutdown()`,
    ],
    {
      env: {
        ...process.env,
        OTEL_ENABLED: 'true',
        OTEL_LOGS_ENABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        OTEL_SERVICE_NAME: 'otel-export-test',
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )

  const timer = setTimeout(() => child.kill(), 15_000)

  expect(await child.exited.finally(() => clearTimeout(timer))).toBe(0)
  const traces = bodies.get('/v1/traces')?.flatMap((b) => b.resourceSpans ?? []) ?? []
  const metrics = bodies.get('/v1/metrics')?.flatMap((b) => b.resourceMetrics ?? []) ?? []
  const logRecords = bodies.get('/v1/logs')?.flatMap((b) => b.resourceLogs ?? []) ?? []
  const service = (resource?: OtlpResource) =>
    resource?.attributes?.find((a) => a.key === 'service.name')?.value.stringValue

  expect(traces.map((r) => service(r.resource))).toContain('otel-export-test')
  expect(
    traces.flatMap((r) => r.scopeSpans ?? []).flatMap((s) => (s.spans ?? []).map((x) => x.name)),
  ).toContain('HTTP GET')
  expect(metrics.map((r) => service(r.resource))).toContain('otel-export-test')
  const names = metrics.flatMap((r) => r.scopeMetrics ?? []).flatMap((s) => s.metrics ?? [])

  expect(names.map((m) => m.name)).toEqual(
    expect.arrayContaining(['http.client.request.duration', 'process.runtime.memory.rss']),
  )
  expect(logRecords.map((r) => service(r.resource))).toContain('otel-export-test')
  expect(
    logRecords
      .flatMap((r) => r.scopeLogs ?? [])
      .flatMap((s) => (s.logRecords ?? []).map((x) => x.body?.stringValue)),
  ).toContain('otel export test log')
}, 20_000)
