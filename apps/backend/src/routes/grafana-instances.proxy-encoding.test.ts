import { gunzipSync, gzipSync } from 'node:zlib'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { responseCompression } from '@/middleware/compression'

import { isGrafanaRead } from '@/middleware/auth/core'

import { grafanaErrorResponse, toGrafanaProxyResponse } from './grafana-instances'

const PAYLOAD = JSON.stringify({ database: 'ok', version: '11.0.0', padding: 'x'.repeat(4096) })

let upstream: ReturnType<typeof Bun.serve>

beforeAll(() => {
  // Mirrors Grafana: gzip the body whenever the request allows it.
  upstream = Bun.serve({
    port: 0,
    fetch(req) {
      const acceptsGzip = (req.headers.get('accept-encoding') ?? '').includes('gzip')

      if (!acceptsGzip) {
        return new Response(PAYLOAD, { headers: { 'content-type': 'application/json' } })
      }

      return new Response(gzipSync(PAYLOAD), {
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      })
    },
  })
})

afterAll(() => {
  void upstream.stop(true)
})

function proxyApp() {
  const app = new Hono()

  app.use('*', responseCompression())
  app.get('/proxy', async () =>
    toGrafanaProxyResponse(await fetch(`http://localhost:${String(upstream.port)}/`)),
  )

  return app
}

async function rawBody(res: Response): Promise<string> {
  const bytes = Buffer.from(await res.arrayBuffer())

  return res.headers.get('content-encoding') === 'gzip'
    ? gunzipSync(bytes).toString('utf8')
    : bytes.toString('utf8')
}

describe('Grafana proxy response encoding', () => {
  test('drops the upstream Content-Encoding once fetch has decoded the body', async () => {
    const upstreamRes = await fetch(`http://localhost:${String(upstream.port)}/`)

    expect(upstreamRes.headers.get('content-encoding')).toBe('gzip')

    const res = toGrafanaProxyResponse(upstreamRes)

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe(PAYLOAD)
  })

  for (const acceptEncoding of [undefined, 'gzip', 'identity']) {
    test(`body matches Content-Encoding for Accept-Encoding: ${acceptEncoding ?? '(none)'}`, async () => {
      const headers: Record<string, string> = {}

      if (acceptEncoding) headers['accept-encoding'] = acceptEncoding
      const res = await proxyApp().request('/proxy', { headers })

      // Decoding per the response's own Content-Encoding must yield the payload,
      // which is what a gzip-aware client such as undici fetch does.
      expect(await rawBody(res)).toBe(PAYLOAD)
    })
  }
})

describe('isGrafanaRead', () => {
  test('treats GET, HEAD and datasource queries as reads', () => {
    expect(isGrafanaRead('GET', 'api/dashboards/uid/x')).toBe(true)
    expect(isGrafanaRead('HEAD', 'api/health')).toBe(true)
    expect(isGrafanaRead('POST', 'api/ds/query')).toBe(true)
  })

  test('treats every other call as a write', () => {
    expect(isGrafanaRead('POST', 'api/dashboards/db')).toBe(false)
    expect(isGrafanaRead('DELETE', 'api/dashboards/uid/x')).toBe(false)
    expect(isGrafanaRead('PUT', 'api/v1/provisioning/alert-rules/x')).toBe(false)
  })
})

describe('grafanaErrorResponse', () => {
  test('keeps the status and Grafana message, never the raw body', async () => {
    const upstream = Response.json(
      { message: 'dashboard not found', internal: 'secret detail' },
      { status: 404 },
    )
    const res = await grafanaErrorResponse(upstream)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'HTTP 404', message: 'dashboard not found' })
  })

  test('reduces a non-JSON body to the status', async () => {
    const res = await grafanaErrorResponse(new Response('<html>internal</html>', { status: 502 }))

    expect(await res.json()).toEqual({ error: 'HTTP 502' })
  })
})
