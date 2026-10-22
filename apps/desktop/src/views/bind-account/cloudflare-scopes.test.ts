import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLOUDFLARE_SCOPE_CATEGORIES } from './cloudflare-scopes.ts'

// The Nuphos OAuth client can only be registered with scopes Cloudflare offers
// OAuth clients. Of the `*.metadata_read` scopes, only Workers Scripts is
// offered; requesting any other fails the authorize request with invalid_scope.
test('Cloudflare scope catalog only requests scopes offered to OAuth clients', () => {
  const unoffered = CLOUDFLARE_SCOPE_CATEGORIES.flatMap((c) => c.scopes).filter(
    (s) => s.endsWith('.metadata_read') && s !== 'workers-scripts.metadata_read',
  )

  assert.deepEqual(unoffered, [])
})
