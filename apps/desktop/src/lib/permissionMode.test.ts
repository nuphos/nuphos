import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PERMISSION_MODE_KEY,
  readDefaultPermissionMode,
  writeDefaultPermissionMode,
} from './permissionMode.ts'

function fakeStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}))

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  }
}

test('defaults to full access when nothing is stored', () => {
  assert.equal(readDefaultPermissionMode(fakeStorage()), 'bypass')
})

test('unrecognized stored values fail safe to auto', () => {
  const storage = fakeStorage({ [PERMISSION_MODE_KEY]: 'yolo' })

  assert.equal(readDefaultPermissionMode(storage), 'auto')
})

test('a written mode round-trips', () => {
  const storage = fakeStorage()

  writeDefaultPermissionMode(storage, 'bypass')
  assert.equal(readDefaultPermissionMode(storage), 'bypass')
  writeDefaultPermissionMode(storage, 'auto')
  assert.equal(readDefaultPermissionMode(storage), 'auto')
})

// Renaming the key would silently reset every user's pick — the legacy name is
// load-bearing.
test('persists under the legacy key', () => {
  const storage = fakeStorage()

  writeDefaultPermissionMode(storage, 'bypass')
  assert.deepEqual(storage.dump(), { 'nuphos.agentPermissionMode': 'bypass' })
})

test('a throwing storage fails safe to auto and swallows writes', () => {
  const throwing = {
    getItem: (): string | null => {
      throw new Error('denied')
    },
    setItem: (): void => {
      throw new Error('denied')
    },
  }

  assert.equal(readDefaultPermissionMode(throwing), 'auto')
  assert.doesNotThrow(() => writeDefaultPermissionMode(throwing, 'bypass'))
})
