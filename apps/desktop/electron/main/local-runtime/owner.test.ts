import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runtimeOwner } from './owner.ts'

test('a Nuphos Cloud user keeps the bare id, so existing runtime homes stay theirs', () => {
  assert.equal(runtimeOwner('u1', 'https://api.nuphos.ai'), 'u1')
  assert.equal(runtimeOwner('u1', 'https://api.nuphos.ai/'), 'u1')
})

test('the same user id on another backend origin owns another runtime home', () => {
  const backends = [
    'https://api.nuphos.ai',
    'https://nuphos.example.com',
    // Scheme and port are part of the backend.
    'http://nuphos.example.com',
    'https://nuphos.example.com:8443',
    'http://127.0.0.1:3718',
    'http://127.0.0.1:3719',
    // Hosts that a character substitution would have merged.
    'https://a-b.example.com',
    'https://a.b.example.com',
  ]
  const owners = new Set(backends.map((api) => runtimeOwner('u1', api)))

  assert.equal(owners.size, backends.length)
  assert.match(runtimeOwner('u1', 'http://127.0.0.1:3718'), /^u1@[0-9a-f]{16}$/u)
  // The same origin always maps to the same home.
  assert.equal(
    runtimeOwner('u1', 'https://nuphos.example.com/'),
    runtimeOwner('u1', 'https://nuphos.example.com'),
  )
})
