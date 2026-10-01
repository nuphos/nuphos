import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { MAX_SKILL_UPLOAD_REQUEST_BYTES, skillUploadBodyLimit } from './upload-body-limit'

function uploadApp(): Hono {
  const app = new Hono()

  app.post('/upload', skillUploadBodyLimit, async (c) => {
    await c.req.parseBody()

    return c.text('ok')
  })

  return app
}

describe('skillUploadBodyLimit', () => {
  test('rejects oversized Content-Length before parseBody', async () => {
    const res = await uploadApp().request('/upload', {
      method: 'POST',
      headers: {
        'content-length': String(MAX_SKILL_UPLOAD_REQUEST_BYTES + 1),
      },
      body: 'x',
    })

    expect(res.status).toBe(413)
    const json = (await res.json()) as { error: { code: string } }

    expect(json.error.code).toBe('skill_upload_too_large')
  })
})
