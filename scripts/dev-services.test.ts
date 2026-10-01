import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  lstatSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { desktop, ensureDeps, lockfileDigest, pruneStaleLauncherLogs } from './dev-services.ts'

test('pruneStaleLauncherLogs removes dead owners but preserves active parallel launchers', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'launcher-logs-'))
  const paths = {
    current: join(logDir, 'nuphos-101-desktop.log'),
    active: join(logDir, 'nuphos-202-desktop.log'),
    stale: join(logDir, 'nuphos-303-desktop.log'),
    otherService: join(logDir, 'nuphos-303-backend.log'),
    otherWorktree: join(logDir, 'feature-303-desktop.log'),
    legacy: join(logDir, 'nuphos-desktop.log'),
  }

  for (const path of Object.values(paths)) writeFileSync(path, '')

  pruneStaleLauncherLogs({
    logDir,
    worktreeId: 'nuphos',
    serviceName: 'desktop',
    currentPid: 101,
    isAlive: (pid) => pid === 202,
  })

  assert.equal(existsSync(paths.stale), false)
  assert.equal(existsSync(paths.current), true)
  assert.equal(existsSync(paths.active), true)
  assert.equal(existsSync(paths.otherService), true)
  assert.equal(existsSync(paths.otherWorktree), true)
  assert.equal(existsSync(paths.legacy), true)
})

test('lockfileDigest changes when the workspace lockfile changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deps-stamp-'))

  writeFileSync(join(dir, 'bun.lock'), 'v1')
  const before = lockfileDigest(dir, 'bun')

  writeFileSync(join(dir, 'bun.lock'), 'v2')
  assert.notEqual(lockfileDigest(dir, 'bun'), before)
})

test('lockfileDigest is stable when nothing changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deps-stable-'))

  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'same')
  assert.equal(lockfileDigest(dir, 'pnpm'), lockfileDigest(dir, 'pnpm'))
})

test('dependency install is non-interactive and isolates borrowed node_modules before retrying', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deps-install-'))
  const bin = join(dir, 'bin')
  const app = join(dir, 'app')
  const borrowed = join(dir, 'borrowed')
  const marker = join(borrowed, 'keep')

  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const path of [bin, app, borrowed]) mkdirSync(path)
  writeFileSync(marker, 'another worktree')
  writeFileSync(join(app, 'pnpm-lock.yaml'), 'lockfile')
  symlinkSync(borrowed, join(app, 'node_modules'))
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/bin/sh
[ "$2" = "--config.confirmModulesPurge=false" ] || exit 10
[ ! -L node_modules ] || exit 11
if [ ! -f retry ]; then
  touch retry
  echo 'ERR_PNPM_TEST_INSTALL: temporary failure' >&2
  exit 1
fi
mkdir -p node_modules/.bin
touch node_modules/.bin/vite
`,
    { mode: 0o755 },
  )
  const previousPath = process.env.PATH

  process.env.PATH = `${bin}:${previousPath}`
  t.after(() => {
    process.env.PATH = previousPath
  })
  const svc = { ...desktop, logStream: null }

  assert.equal(await ensureDeps(svc, app, 'pnpm', 'vite'), false)
  assert.equal(svc.status, 'crashed')
  assert.equal(readFileSync(marker, 'utf8'), 'another worktree')
  assert.equal(await ensureDeps(svc, app, 'pnpm', 'vite'), true)
  assert.equal(lstatSync(join(app, 'node_modules')).isSymbolicLink(), false)
  assert.equal(readFileSync(marker, 'utf8'), 'another worktree')
  // A successful install is stamped; a warm boot must not invoke pnpm again.
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\nexit 12\n', { mode: 0o755 })
  assert.equal(await ensureDeps(svc, app, 'pnpm', 'vite'), true)
})
