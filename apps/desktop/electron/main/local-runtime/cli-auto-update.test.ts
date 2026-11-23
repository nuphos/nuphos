import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  autoInstallFiles,
  checkCliUpdate,
  cliAutoUpdate,
  newerRelease,
  readCliAutoInstall,
  runCliUpdate,
  tickCliUpdate,
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
    update: async () => {
      calls.update++

      return true
    },
    ...overrides,
  }

  return { value, calls }
}

test('a computer with a newer CLI out and no task running updates itself, once', async () => {
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

test('it waits while a task runs, and updates at the first check between turns (#4210)', async () => {
  let running = true
  const { value, calls } = deps({ busy: () => running })

  assert.equal(await checkCliUpdate(value), null)
  assert.equal(calls.update, 0)
  // The turn ended a moment ago: no idle minutes are waited for.
  running = false
  assert.equal(await checkCliUpdate(value), '0.23.0')
  assert.equal(calls.update, 1)
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

test('only a host that updates itself reports the switch, not one in the foreground (#4792)', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'cli-auto-update-'))
  const status = (env: NodeJS.ProcessEnv) =>
    cliAutoUpdate(
      () => 'http://127.0.0.1:1',
      () => {},
      env,
    ).wrap(() => ({}))[0]()

  assert.deepEqual(status({ NUPHOS_AGENT_HOME: home, NUPHOS_CLI_VERSION: '0.22.0' }), {})
  assert.deepEqual(
    status({
      NUPHOS_AGENT_HOME: home,
      NUPHOS_CLI_VERSION: '0.22.0',
      NUPHOS_CLI_EXE: '/bin/nuphos',
    }),
    { autoInstall: true },
  )
})

test('releases compare by number', () => {
  assert.equal(newerRelease('0.22.0', '0.13.0'), true)
  assert.equal(newerRelease('0.13.0', '0.22.0'), false)
  assert.equal(newerRelease('0.22.0', '0.22.0'), false)
  assert.equal(newerRelease('1.0.0', '0.99.9'), true)
  assert.equal(newerRelease('0.22.0-dev', '0.13.0'), false)
})

test('an update that could not start is not noted as tried, and is tried again', async () => {
  let started = false
  const { value, calls } = deps({
    update: async () => {
      calls.update++

      return started
    },
  })

  assert.equal(await checkCliUpdate(value), null)
  assert.equal(readCliAutoInstall(value.home).enabled, true)
  started = true
  assert.equal(await checkCliUpdate(value), '0.23.0')
  assert.equal(calls.update, 2)
})

test('a check that fails is logged, never thrown at the host', async () => {
  // An agent home that is a file: the note of the tried release cannot be written.
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'cli-auto-update-')), 'home')

  writeFileSync(file, '')
  const { value } = deps({ home: file })

  await assert.rejects(checkCliUpdate(value))
  assert.equal(await tickCliUpdate(value), null)
})

test('nuphos update that cannot start says so instead of crashing the host', async () => {
  assert.equal(await runCliUpdate(path.join(tmpdir(), 'no-such-nuphos')), false)
  // Node itself starts on every platform (macOS has no /bin/true).
  assert.equal(await runCliUpdate(process.execPath), true)
})
