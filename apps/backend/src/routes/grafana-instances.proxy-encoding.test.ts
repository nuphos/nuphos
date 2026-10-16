import { gunzipSync, gzipSync } from 'node:zlib'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { responseCompression } from '@/middleware/compression'

import { toGrafanaProxyResponse } from './grafana-instances'

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
