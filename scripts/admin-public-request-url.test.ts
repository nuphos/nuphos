import assert from 'node:assert/strict'
import test from 'node:test'

import { publicRequestUrl } from '../apps/admin/lib/public-request-url.ts'

test('Admin redirects use the browser-visible authority behind a proxy', () => {
  const request = {
    headers: new Headers({
      host: '0.0.0.0:3719',
      'x-forwarded-host': 'admin.nuphos.ai',
      'x-forwarded-proto': 'https',
    }),
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- models the internal listener behind TLS termination
    nextUrl: new URL('http://0.0.0.0:3719/plans/action'),
  }

  assert.equal(
    publicRequestUrl(request, '/plans?banner=updated').toString(),
    'https://admin.nuphos.ai/plans?banner=updated',
  )
})

test('Admin redirects preserve direct local origins', () => {
  const request = {
    headers: new Headers({ host: 'local.nuphos.ai:3719' }),
    nextUrl: new URL('https://local.nuphos.ai:3719/plans/action'),
  }

  assert.equal(
    publicRequestUrl(request, '/plans?banner=updated').toString(),
    'https://local.nuphos.ai:3719/plans?banner=updated',
  )
})

test('Admin redirects ignore unsupported forwarded protocols', () => {
  const request = {
    headers: new Headers({
      host: 'admin.nuphos.ai',
      'x-forwarded-proto': 'javascript',
    }),
    nextUrl: new URL('https://admin.nuphos.ai/plans/action'),
  }

  assert.equal(publicRequestUrl(request, '/plans').toString(), 'https://admin.nuphos.ai/plans')
})
