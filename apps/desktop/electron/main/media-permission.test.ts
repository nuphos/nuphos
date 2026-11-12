import assert from 'node:assert/strict'
import test from 'node:test'

import { grantsMicrophone } from './media-permission.ts'

const APP = 'app://./index.html'

test('the app page may use the microphone, and nothing else', () => {
  assert.equal(grantsMicrophone('app://./index.html#/agent', ['audio'], APP), true)
  assert.equal(grantsMicrophone('app://./index.html', ['audio', 'video'], APP), false)
  assert.equal(grantsMicrophone('app://./index.html', ['video'], APP), false)
  assert.equal(grantsMicrophone('app://./index.html', [], APP), false)
  assert.equal(grantsMicrophone('app://./index.html', undefined, APP), false)
})

test('another origin may not use the microphone', () => {
  assert.equal(grantsMicrophone('https://example.com/', ['audio'], APP), false)
  assert.equal(grantsMicrophone('not a url', ['audio'], APP), false)
  assert.equal(grantsMicrophone('http://localhost:5173/', ['audio'], 'http://localhost:5173'), true)
  assert.equal(
    grantsMicrophone('http://localhost:5174/', ['audio'], 'http://localhost:5173'),
    false,
  )
})
