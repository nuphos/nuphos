import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { resolveUserData } from './user-data.ts'

function withAppData(run: (appData: string) => void): void {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-user-data-'))

  try {
    run(appData)
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
}

function write(file: string, content = '{}'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

// Every directory and file in appData, so a test can assert nothing moved.
function snapshot(appData: string): string[] {
  return fs.readdirSync(appData, { recursive: true, encoding: 'utf8' }).sort()
}

test('a fresh install uses <appData>/<appName> and creates nothing', () => {
  withAppData((appData) => {
    assert.equal(resolveUserData(appData, 'Nuphos'), path.join(appData, 'Nuphos'))
    assert.deepEqual(fs.readdirSync(appData), [])
  })
})

test('an install whose profile is in the legacy directory keeps using it', () => {
  withAppData((appData) => {
    write(path.join(appData, 'k8s-gui', 'Local Storage', 'leveldb', 'CURRENT'))
    const before = snapshot(appData)

    assert.equal(resolveUserData(appData, 'Nuphos'), path.join(appData, 'k8s-gui'))
    assert.deepEqual(snapshot(appData), before)
  })
})

test('a legacy profile wins over a directory at the new name, and neither moves', () => {
  withAppData((appData) => {
    // Some earlier releases used <appData>/Nuphos, so an install can hold a stale copy there.
    write(path.join(appData, 'Nuphos', 'Local Storage', 'leveldb', 'CURRENT'), 'stale')
    write(path.join(appData, 'k8s-gui', 'IndexedDB', 'file__0.indexeddb.leveldb', 'CURRENT'))
    const before = snapshot(appData)

    assert.equal(resolveUserData(appData, 'Nuphos'), path.join(appData, 'k8s-gui'))
    assert.deepEqual(snapshot(appData), before)
  })
})

test('an empty legacy directory is not a profile', () => {
  withAppData((appData) => {
    // Reading app.getPath('userData') creates the default directory, empty.
    fs.mkdirSync(path.join(appData, 'k8s-gui'))
    write(path.join(appData, 'Nuphos', 'Local Storage', 'leveldb', 'CURRENT'))
    const before = snapshot(appData)

    assert.equal(resolveUserData(appData, 'Nuphos'), path.join(appData, 'Nuphos'))
    assert.deepEqual(snapshot(appData), before)
  })
})

test('a legacy directory with only non-profile files is not a profile', () => {
  withAppData((appData) => {
    // What an import-time read can leave behind before setPath runs.
    fs.mkdirSync(path.join(appData, 'k8s-gui', 'local-runtime', 'desktops'), { recursive: true })

    assert.equal(resolveUserData(appData, 'Nuphos'), path.join(appData, 'Nuphos'))
  })
})
