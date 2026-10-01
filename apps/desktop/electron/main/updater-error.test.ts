import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyUpdaterError,
  createUpdaterErrorDedupe,
  updaterTelemetryError,
} from './updater-error.ts'

test('classifies updater failures by actionable cause', () => {
  assert.equal(
    classifyUpdaterError('Code signature at URL file:///tmp/Nuphos.app failed'),
    'signature_validation',
  )
  assert.equal(
    classifyUpdaterError('Cannot update while running on a read-only volume'),
    'read_only_volume',
  )
  assert.equal(
    classifyUpdaterError('ditto: app.asar: No such file or directory'),
    'staging_filesystem',
  )
  assert.equal(classifyUpdaterError('403 Forbidden latest-linux.yml'), 'channel_manifest')
  assert.equal(classifyUpdaterError('net::ERR_NETWORK_CHANGED'), 'network')
  assert.equal(classifyUpdaterError('Unexpected updater response'), 'other')
})

test('redacts local usernames, URL credentials, and random staging ids from telemetry', () => {
  const cases = [
    [
      '/Users/alice/Library/Caches/app/update.a1B2c3/Nuphos.app failed',
      '/Users/<redacted>/Library/Caches/app/update.<id>/Nuphos.app failed',
    ],
    [
      String.raw`C:\Users\alice\AppData\Local\app\update.a1B2c3\Nuphos.exe failed`,
      String.raw`C:\Users\<redacted>\AppData\Local\app\update.<id>\Nuphos.exe failed`,
    ],
    [
      '/home/alice/.cache/app/update.a1B2c3/Nuphos failed',
      '/home/<redacted>/.cache/app/update.<id>/Nuphos failed',
    ],
    [
      'https://alice:secret@updates.example.com/latest.yml failed',
      'https://<redacted>@updates.example.com/latest.yml failed',
    ],
  ]

  for (const [message, expected] of cases) {
    assert.equal(updaterTelemetryError(new Error(message)).message, expected)
  }
})

test('captures each updater error category once per app process', () => {
  const shouldCapture = createUpdaterErrorDedupe()

  assert.equal(shouldCapture('signature_validation'), true)
  assert.equal(shouldCapture('signature_validation'), false)
  assert.equal(shouldCapture('network'), true)
})
