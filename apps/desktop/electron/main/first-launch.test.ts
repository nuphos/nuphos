import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { prepareFirstLaunch } from './first-launch.ts'

test('only fresh app data gets the intro, including after complete data removal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-first-launch-'))
  const userData = path.join(root, 'Nuphos')

  try {
    assert.equal(prepareFirstLaunch(userData)(), true)
    assert.equal(prepareFirstLaunch(userData)(), false)
    fs.rmSync(userData, { recursive: true })
    assert.equal(prepareFirstLaunch(userData)(), true)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})

test('upgrading an existing installation does not show the intro', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-first-launch-'))

  try {
    fs.writeFileSync(path.join(root, 'Preferences'), '{}')
    assert.equal(prepareFirstLaunch(root)(), false)
    assert.equal(prepareFirstLaunch(root)(), false)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})

test('unwritable app data fails open without replaying the intro', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-first-launch-'))
  const file = path.join(root, 'file')

  try {
    fs.writeFileSync(file, '')
    assert.equal(prepareFirstLaunch(file)(), false)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})

// Electron creates Singleton files while acquiring the instance lock.
test('snapshot precedes Electron initialization and a competing claim loses', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-first-launch-'))

  try {
    const claim = prepareFirstLaunch(root)
    const otherClaim = prepareFirstLaunch(root)

    fs.writeFileSync(path.join(root, 'SingletonLock'), '')
    assert.equal(claim(), true)
    assert.equal(otherClaim(), false)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})
