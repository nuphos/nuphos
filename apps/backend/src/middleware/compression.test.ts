import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { responseCompression } from './compression'

const BIG_JSON = { messages: Array.from({ length: 200 }, (_, i) => ({ i, text: 'x'.repeat(40) })) }

function buildApp() {
  const app = new Hono()

  app.use('*', responseCompression())
  app.get('/json', (c) => c.json(BIG_JSON))
  app.get('/sse', (c) =>
    c.body(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(BIG_JSON)}\n\n`))
          controller.close()
        },
      }),
      200,
      {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
      },
    ),
  )

  return app
}

async function gunzip(res: Response): Promise<string> {
  const body = res.body

  if (!body) throw new Error('no body')

  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text()
}

describe('responseCompression', () => {
  test('gzips JSON when the client accepts it, and the payload round-trips', async () => {
    const res = await buildApp().request('/json', {
      headers: { 'accept-encoding': 'gzip, deflate, br' },
    })

    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
    expect(JSON.parse(await gunzip(res))).toEqual(BIG_JSON)
  })

  test('sends identity when the client does not accept an encoding', async () => {
    const res = await buildApp().request('/json')

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
    expect(await res.json()).toEqual(BIG_JSON)
  })

  test('leaves the agent SSE stream uncompressed even when gzip is accepted', async () => {
    const res = await buildApp().request('/sse', { headers: { 'accept-encoding': 'gzip' } })

    expect(res.headers.get('content-encoding')).toBeNull()
    expect(await res.text()).toContain('data: {"messages"')
  })

  test('inner middleware still observes the uncompressed Content-Length', async () => {
    const app = new Hono()
    const body = JSON.stringify(BIG_JSON)
    let observed: string | null = 'unset'

    app.use('*', responseCompression())
    // Stands in for otelHono: registered after compression, so its post-next
    // code runs before the response is compressed.
    app.use('*', async (c, next) => {
      await next()
      observed = c.res.headers.get('content-length')
    })
    app.get('/json', (c) =>
      c.body(body, 200, {
        'content-type': 'application/json',
        'content-length': String(body.length),
      }),
    )
    const res = await app.request('/json', { headers: { 'accept-encoding': 'gzip' } })

    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(res.headers.get('content-length')).toBeNull()
    expect(observed).toBe(String(body.length))
  })

  // index-app.ts boots routes and config at import, so pin the wiring by
  // reading the source: the middleware must be registered on the app, and
  // before otelHono, which reads Content-Length after the handler ran.
  test('is registered on the app ahead of otelHono', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'index-app.ts'), 'utf8')
    const compression = src.indexOf("app.use('*', responseCompression())")
    const otel = src.indexOf("app.use('*', otelHono())")

    expect(compression).toBeGreaterThan(-1)
    expect(otel).toBeGreaterThan(-1)
    expect(compression).toBeLessThan(otel)
  })
})
