import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runtimeOwner } from './owner.ts'

test('a Nuphos Cloud user keeps the bare id, so existing runtime homes stay theirs', () => {
  assert.equal(runtimeOwner('u1', 'https://api.nuphos.ai'), 'u1')
  assert.equal(runtimeOwner('u1', 'https://api.nuphos.ai/'), 'u1')
})

test('the same user id on another backend owns another runtime home', () => {
  const owners = new Set([
    runtimeOwner('u1', 'https://api.nuphos.ai'),
    runtimeOwner('u1', 'https://nuphos.example.com'),
    runtimeOwner('u1', 'http://127.0.0.1:3718'),
    runtimeOwner('u1', 'http://127.0.0.1:3719'),
  ])

  assert.equal(owners.size, 4)
  assert.equal(runtimeOwner('u1', 'http://127.0.0.1:3718'), 'u1@127.0.0.1_3718')
})
