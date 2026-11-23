import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { hasProfile, resolveUserData } from './user-data.ts'

const LEGACY = 'k8s-gui'
const APP = 'Nuphos'

/** A throwaway appData directory, removed whether or not the test throws. */
function withAppData(run: (appData: string) => void): void {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-user-data-'))

  try {
    run(appData)
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
}

/** Everything under appData, so a test can prove the choice changed nothing. */
function snapshot(appData: string): string[] {
  return fs.readdirSync(appData, { recursive: true, encoding: 'utf8' }).sort()
}

function write(file: string, content = '{}'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

/** A profile the way Chromium leaves one behind. */
function writeProfile(dir: string, content = '{}'): void {
  write(path.join(dir, 'Local Storage', 'leveldb', 'CURRENT'), content)
}

test('a fresh install gets the app directory, and nothing is created', () => {
  withAppData((appData) => {
    const choice = resolveUserData(appData, APP)

    assert.equal(choice.dir, path.join(appData, APP))
    assert.equal(choice.leftAlone, null)
    assert.deepEqual(fs.readdirSync(appData), [])
  })
})

test('an install whose profile is in the legacy directory keeps using it', () => {
  withAppData((appData) => {
    writeProfile(path.join(appData, LEGACY))
    const before = snapshot(appData)
    const choice = resolveUserData(appData, APP)

    assert.equal(choice.dir, path.join(appData, LEGACY))
    assert.equal(choice.leftAlone, null)
    // Its sign-in, settings and agent homes stay exactly where they are.
    assert.deepEqual(snapshot(appData), before)
  })
})

test('a legacy profile wins over a profile at the app name, and neither is touched', () => {
  withAppData((appData) => {
    writeProfile(path.join(appData, APP), 'stale')
    writeProfile(path.join(appData, LEGACY))
    const before = snapshot(appData)
    const choice = resolveUserData(appData, APP)

    assert.equal(choice.dir, path.join(appData, LEGACY))
    assert.equal(choice.leftAlone, path.join(appData, APP))
    assert.deepEqual(snapshot(appData), before)
  })
})

test('an empty legacy directory is not a profile', () => {
  withAppData((appData) => {
    // What reading app.getPath('userData') leaves behind before anything writes there.
    fs.mkdirSync(path.join(appData, LEGACY))
    writeProfile(path.join(appData, APP))
    const before = snapshot(appData)
    const choice = resolveUserData(appData, APP)

    assert.equal(choice.dir, path.join(appData, APP))
    assert.equal(choice.leftAlone, null)
    assert.deepEqual(snapshot(appData), before)
  })
})

test('a profile is Local Storage, IndexedDB or Preferences, and nothing else', () => {
  withAppData((appData) => {
    const dir = path.join(appData, 'probe')

    fs.mkdirSync(dir)
    assert.equal(hasProfile(dir), false)

    // The runtime's own data, and a directory an import-time read created.
    fs.mkdirSync(path.join(dir, 'local-runtime', 'desktops'), { recursive: true })
    assert.equal(hasProfile(dir), false)

    fs.mkdirSync(path.join(dir, 'Local Storage', 'leveldb'), { recursive: true })
    assert.equal(hasProfile(dir), true)

    fs.rmSync(path.join(dir, 'Local Storage'), { recursive: true, force: true })
    assert.equal(hasProfile(dir), false)

    fs.mkdirSync(path.join(dir, 'IndexedDB'))
    assert.equal(hasProfile(dir), true)

    fs.rmSync(path.join(dir, 'IndexedDB'), { recursive: true, force: true })
    write(path.join(dir, 'Preferences'))
    assert.equal(hasProfile(dir), true)
  })
})

test('resolving twice picks the same directory, and still changes nothing', () => {
  withAppData((appData) => {
    writeProfile(path.join(appData, LEGACY))
    const before = snapshot(appData)

    assert.deepEqual(resolveUserData(appData, APP), resolveUserData(appData, APP))
    assert.deepEqual(snapshot(appData), before)
  })
})
