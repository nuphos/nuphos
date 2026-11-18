import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { before, mock } from 'node:test'

import type * as AutoInstall from './auto-update-electron.ts'

let userData = ''
let loads = 0

before(() => {
  mock.module('electron', {
    namedExports: { app: { getPath: () => userData }, powerMonitor: {} },
  })
  mock.module('./local-runtime/sleep-prevention-electron.ts', {
    namedExports: { taskActivity: { busy: () => false } },
  })
})

/** The preference as a fresh app launch reads it, with `saved` as this computer's file. */
async function launch(saved?: string) {
  userData = mkdtempSync(join(tmpdir(), 'auto-update-'))
  if (saved !== undefined) writeFileSync(join(userData, 'auto-update.json'), saved)
  loads += 1

  return (await import(`./auto-update-electron.ts?launch=${String(loads)}`)) as typeof AutoInstall
}

test('a computer whose owner never chose installs updates automatically', async () => {
  assert.deepEqual((await launch()).readAutoInstall(), { enabled: true })
})

test('a computer whose owner turned it off stays off', async () => {
  assert.deepEqual((await launch('{"enabled":false}')).readAutoInstall(), { enabled: false })
})

test('turning it off is saved, so the next launch keeps it off', async () => {
  const app = await launch()

  assert.deepEqual(app.writeAutoInstall({ enabled: false }), { enabled: false })
  assert.equal(readFileSync(join(userData, 'auto-update.json'), 'utf8'), '{"enabled":false}')
})
