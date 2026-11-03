import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { streamSSE } from 'hono/streaming'

import { responseCompression } from './compression'
import { jsonEtag } from './etag'

const PLANS = { plans: Array.from({ length: 100 }, (_, i) => ({ id: i, title: 'x'.repeat(40) })) }

function buildApp() {
  const app = new Hono()
  let plans: unknown = PLANS

  app.use('*', responseCompression())
  app.use('*', requestId())
  app.use('*', cors({ origin: '*' }))
  app.use('*', jsonEtag())
  app.get('/plans', (c) => c.json(plans))
  app.post('/plans', async (c) => {
    plans = await c.req.json()

    return c.json(plans)
  })
  app.get('/missing', (c) => c.json({ error: 'not found' }, 404))
  app.get('/text', (c) => c.text('hello'))
  app.get('/secret', (c) => {
    c.header('Cache-Control', 'private, no-store')

    return c.json({ token: 'short-lived' })
  })
  app.get('/dated', (c) => {
    c.header('Last-Modified', 'Tue, 03 Nov 2026 00:00:00 GMT')

    return c.json(PLANS)
  })
  app.get('/own-tag', (c) => {
    c.header('ETag', '"rev-1"')
    if (c.req.header('If-None-Match') === '"rev-1"') return c.body(null, 304)

    return c.json(PLANS)
  })
  app.get('/sse', (c) =>
    streamSSE(c, async (stream) => {
      for (;;) {
        await stream.writeSSE({ data: 'tick' })
        await stream.sleep(50)
      }
    }),
  )

  return app
}

describe('jsonEtag', () => {
  test('tags a JSON GET and answers a matching If-None-Match with an empty 304', async () => {
    const app = buildApp()
    const first = await app.request('/plans')
    const tag = first.headers.get('etag')

    expect(first.status).toBe(200)
    // SHA-256, base64url: 43 characters.
    expect(tag).toMatch(/^W\/"[\w-]{43}"$/)
    const again = await app.request('/plans', { headers: { 'if-none-match': tag ?? '' } })

    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    expect(again.headers.get('etag')).toBe(tag)
    expect(again.headers.get('content-type')).toBeNull()
    expect(again.headers.get('content-length')).toBeNull()
    expect(again.headers.get('access-control-allow-origin')).toBe('*')
    expect(again.headers.get('x-request-id')).toBeTruthy()
    expect(again.headers.get('vary')).toContain('Accept-Encoding')
  })

  test('sends a full 200 with a new tag once the body changed', async () => {
    const app = buildApp()
    const tag = (await app.request('/plans')).headers.get('etag') ?? ''

    await app.request('/plans', { method: 'POST', body: JSON.stringify({ plans: [] }) })
    const res = await app.request('/plans', { headers: { 'if-none-match': tag } })

    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).not.toBe(tag)
    expect(await res.json()).toEqual({ plans: [] })
  })

  test('compares If-None-Match weakly, across a list, and honours a lone *', async () => {
    const app = buildApp()
    const tag = (await app.request('/plans')).headers.get('etag') ?? ''
    const strong = tag.replace(/^W\//, '')

    for (const header of [strong, `"other", ${tag}`, `W/"a,b", ${strong}`, '*']) {
      const res = await app.request('/plans', { headers: { 'if-none-match': header } })

      expect(res.status).toBe(304)
    }
  })

  test('answers a failed If-Match with 412 before If-None-Match, and lets * through', async () => {
    const app = buildApp()
    const tag = (await app.request('/plans')).headers.get('etag') ?? ''
    const failed = await app.request('/plans', {
      headers: { 'if-match': tag, 'if-none-match': tag },
    })
    const any = await app.request('/plans', { headers: { 'if-match': '*' } })

    // A weak tag never matches under If-Match's strong comparison.
    expect(failed.status).toBe(412)
    expect(await failed.text()).toBe('')
    expect(any.status).toBe(200)
  })

  test('ignores If-Modified-Since and If-Unmodified-Since, having no Last-Modified', async () => {
    const res = await buildApp().request('/plans', {
      headers: {
        'if-modified-since': 'Tue, 03 Nov 2099 00:00:00 GMT',
        'if-unmodified-since': 'Tue, 03 Nov 1999 00:00:00 GMT',
      },
    })

    expect(res.status).toBe(200)
  })

  test('leaves no-store and Last-Modified responses untagged', async () => {
    const app = buildApp()
    const secret = await app.request('/secret', { headers: { 'if-none-match': '*' } })
    const dated = await app.request('/dated')

    expect(secret.status).toBe(200)
    expect(secret.headers.get('etag')).toBeNull()
    expect(dated.headers.get('etag')).toBeNull()
  })

  test('hashes the uncompressed body, so gzip and identity share one tag', async () => {
    const app = buildApp()
    const plain = await app.request('/plans')
    const gzipped = await app.request('/plans', { headers: { 'accept-encoding': 'gzip' } })

    expect(gzipped.headers.get('content-encoding')).toBe('gzip')
    expect(gzipped.headers.get('etag')).toBe(plain.headers.get('etag'))
    const revalidated = await app.request('/plans', {
      headers: { 'accept-encoding': 'gzip', 'if-none-match': gzipped.headers.get('etag') ?? '' },
    })

    expect(revalidated.status).toBe(304)
    expect(revalidated.headers.get('content-encoding')).toBeNull()
  })

  test('leaves non-GET, non-200 and non-JSON responses untagged', async () => {
    const app = buildApp()
    const post = await app.request('/plans', { method: 'POST', body: '{"plans":[]}' })
    const missing = await app.request('/missing')
    const text = await app.request('/text')

    expect(post.headers.get('etag')).toBeNull()
    expect(missing.status).toBe(404)
    expect(missing.headers.get('etag')).toBeNull()
    expect(text.headers.get('etag')).toBeNull()
  })

  test('keeps a handler-set ETag and its own 304 handling', async () => {
    const app = buildApp()
    const first = await app.request('/own-tag')
    const again = await app.request('/own-tag', { headers: { 'if-none-match': '"rev-1"' } })

    expect(first.headers.get('etag')).toBe('"rev-1"')
    expect(again.status).toBe(304)
  })

  test('streams SSE without waiting for the stream to end', async () => {
    const res = await buildApp().request('/sse')
    const reader = res.body?.getReader()
    const first = await Promise.race([
      reader?.read().then((r) => new TextDecoder().decode(r.value)),
      Bun.sleep(1000).then(() => 'timed out'),
    ])

    await reader?.cancel()
    expect(first).toContain('data: tick')
    expect(res.headers.get('etag')).toBeNull()
  })

  // Pins the wiring by source, like compression.test.ts: inside compression,
  // and after the middleware that should record the 304.
  test('is registered on the app inside compression and after analytics', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'index-app.ts'), 'utf8')
    const at = (s: string) => src.indexOf(s)

    expect(at("app.use('*', jsonEtag())")).toBeGreaterThan(
      at("app.use('*', responseCompression())"),
    )
    expect(at("app.use('*', jsonEtag())")).toBeGreaterThan(at("app.use('*', analyticsMiddleware)"))
    expect(at("app.use('*', responseCompression())")).toBeGreaterThan(-1)
  })
})
