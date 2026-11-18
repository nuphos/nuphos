import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  autoInstallFiles,
  checkCliUpdate,
  idleClock,
  newerRelease,
  readCliAutoInstall,
  withAutoInstallRequest,
  writeCliAutoInstall,
} from './cli-auto-update.ts'

import type { CliAutoUpdateDeps } from './cli-auto-update.ts'

// Run with: cd apps/desktop && node --experimental-strip-types --test electron/main/local-runtime/cli-auto-update.test.ts

function deps(overrides: Partial<CliAutoUpdateDeps> = {}) {
  const calls = { update: 0 }
  const value: CliAutoUpdateDeps = {
    version: '0.22.0',
    home: mkdtempSync(path.join(tmpdir(), 'cli-auto-update-')),
    latest: async () => '0.23.0',
    busy: () => false,
    idleSeconds: () => 11 * 60,
    update: () => {
      calls.update++
    },
    ...overrides,
  }

  return { value, calls }
}

test('a computer with a newer CLI out and nothing run for 10 minutes updates itself, once', async () => {
  const { value, calls } = deps()

  assert.equal(await checkCliUpdate(value), '0.23.0')
  assert.equal(calls.update, 1)
  // The host came back on the old release: the same release is not tried again on its own.
  assert.equal(await checkCliUpdate(value), null)
  assert.equal(calls.update, 1)
  assert.equal(readFileSync(autoInstallFiles(value.home).tried, 'utf8'), '0.23.0')
  // A newer release is.
  assert.equal(await checkCliUpdate({ ...value, latest: async () => '0.24.0' }), '0.24.0')
  assert.equal(calls.update, 2)
})

test('it waits while a task runs or ran in the last 10 minutes', async () => {
  for (const overrides of [{ busy: () => true }, { idleSeconds: () => 9 * 60 }]) {
    const { value, calls } = deps(overrides)

    assert.equal(await checkCliUpdate(value), null)
    assert.equal(calls.update, 0)
  }
})

test('it does nothing when switched off, current, or the release cannot be read', async () => {
  const off = deps()

  writeCliAutoInstall(off.value.home, { enabled: false })
  for (const { value, calls } of [
    off,
    deps({ latest: async () => '0.22.0' }),
    deps({ latest: async () => null }),
    deps({ latest: () => Promise.reject(new Error('offline')) }),
  ]) {
    assert.equal(await checkCliUpdate(value), null)
    assert.equal(calls.update, 0)
  }
})

test('the switch is on until the card turns it off, and other requests pass through', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'cli-auto-update-'))
  const passed: unknown[] = []
  let sent = 0
  const handle = withAutoInstallRequest(
    async (request) => {
      passed.push(request)

      return 'handled'
    },
    (value) => writeCliAutoInstall(home, value),
    () => {
      sent++
    },
  )

  assert.equal(readCliAutoInstall(home).enabled, true)
  assert.deepEqual(await handle({ method: 'autoInstall', enabled: false }), { enabled: false })
  assert.equal(readCliAutoInstall(home).enabled, false)
  // The status goes out at once, so the card shows it.
  assert.equal(sent, 1)
  await assert.rejects(handle({ method: 'autoInstall', enabled: 'no' }))
  assert.equal(await handle({ method: 'update' }), 'handled')
  assert.deepEqual(passed, [{ method: 'update' }])
  // A broken file reads as the default, on.
  writeFileSync(autoInstallFiles(home).preferences, '{')
  assert.equal(readCliAutoInstall(home).enabled, true)
})

test('idle time counts from the last task, and is zero while one runs', () => {
  let now = 0
  const clock = idleClock(() => now)

  now = 120_000
  assert.equal(clock.idleSeconds(), 120)
  clock.activity.open('s1', 'terminal')
  now = 300_000
  assert.equal(clock.idleSeconds(), 0)
  clock.activity.close('s1')
  now = 360_000
  assert.equal(clock.idleSeconds(), 60)
})

test('releases compare by number', () => {
  assert.equal(newerRelease('0.22.0', '0.13.0'), true)
  assert.equal(newerRelease('0.13.0', '0.22.0'), false)
  assert.equal(newerRelease('0.22.0', '0.22.0'), false)
  assert.equal(newerRelease('1.0.0', '0.99.9'), true)
  assert.equal(newerRelease('0.22.0-dev', '0.13.0'), false)
})
