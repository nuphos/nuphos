import { Hono } from 'hono'

import { readAvatar } from '@/lib/identity/avatar-upload'

export const avatarsRoutes = new Hono()

// Public like the Google CDN URLs it replaces: <img> tags and Slack can't send
// a bearer token. The content hash in the path makes each URL immutable.
avatarsRoutes.get('/:userId/:file', async (c) => {
  const match = /^([0-9a-f]{64})\.webp$/.exec(c.req.param('file'))
  const bytes = match?.[1] ? await readAvatar(c.req.param('userId'), match[1]) : null

  if (!bytes) return c.body(null, 404)

  return c.body(bytes, 200, {
    'content-type': 'image/webp',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
  })
})
