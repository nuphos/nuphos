import assert from 'node:assert/strict'
import test from 'node:test'

import { selectCrashDiagnostic } from './dev-child-output.ts'

test('selectCrashDiagnostic prefers a concrete failure over package-manager noise', () => {
  const diagnostic = selectCrashDiagnostic([
    '> k8s-gui@0.25.0 electron:dev /tmp/worktree/apps/desktop',
    '> vite',
    'sh: vite: command not found',
    '\x1b[41m\x1b[30m ELIFECYCLE \x1b[0m Command failed.',
  ])

  assert.equal(diagnostic, 'sh: vite: command not found')
})

test('selectCrashDiagnostic strips ANSI and falls back to the newest useful line', () => {
  const diagnostic = selectCrashDiagnostic([
    '\x1b[31mFailed to load config from vite.config.ts\x1b[0m',
    'startup aborted',
  ])

  assert.equal(diagnostic, 'Failed to load config from vite.config.ts')
})

test('selectCrashDiagnostic ignores successful startup markers', () => {
  const diagnostic = selectCrashDiagnostic([
    'VITE v8.0.10 ready in 201 ms',
    'Local: http://localhost:5173/',
    '[nuphos-dev] electron window opened',
  ])

  assert.equal(diagnostic, null)
})

test('deprecation warnings and their trace hint are not crash diagnostics', () => {
  const warnings = [
    '(node:22847) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.',
    '(Use `Electron --trace-deprecation ...` to show where the warning was created)',
  ]

  assert.equal(selectCrashDiagnostic(warnings), null)
  assert.equal(
    selectCrashDiagnostic(['Error: startup failed', ...warnings]),
    'Error: startup failed',
  )
})

test('pnpm install errors survive later update notices', () => {
  const error =
    'ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY Aborted removal of modules directory due to no TTY'

  assert.equal(
    selectCrashDiagnostic([error, 'Update available! 10.34.5 → 12.6.0.', 'Run pnpm self-update']),
    error,
  )
})
