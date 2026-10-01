import assert from 'node:assert/strict'
import { test } from 'node:test'

import { envValue, hostsLocalAdmin } from './dev-admin.ts'

test('envValue reads quoted and unquoted values', () => {
  const contents = [
    'ATLAS_DEV_TLS_CERT=/opt/certs/plain.pem',
    'ATLAS_DEV_TLS_KEY="/opt/certs/quoted key.pem"',
  ].join('\n')

  assert.equal(envValue(contents, 'ATLAS_DEV_TLS_CERT'), '/opt/certs/plain.pem')
  assert.equal(envValue(contents, 'ATLAS_DEV_TLS_KEY'), '/opt/certs/quoted key.pem')
  assert.equal(envValue(contents, 'MISSING'), null)
})

test('hostsLocalAdmin ignores comments and matches host aliases', () => {
  assert.equal(hostsLocalAdmin('# 127.0.0.1 local.nuphos.ai'), false)
  assert.equal(hostsLocalAdmin('127.0.0.1 localhost local.nuphos.ai'), true)
  assert.equal(hostsLocalAdmin('127.0.0.1 local.nuphos.ai.example'), false)
})
