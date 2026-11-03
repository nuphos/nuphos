import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const store = new Map<string, string>()

Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const { readAccountStorage, setStorageAccount, writeAccountStorage } =
  await import('./accountStorage.ts')

const KEY = 'nuphos.workspace.lastTeamId'

beforeEach(() => store.clear())

test('each account reads only what it stored', () => {
  setStorageAccount('a@https://api.nuphos.ai')
  writeAccountStorage(KEY, 'team-a')
  setStorageAccount('b@https://nuphos.example.com')
  assert.equal(readAccountStorage(KEY), null)
  writeAccountStorage(KEY, 'team-b')
  setStorageAccount('a@https://api.nuphos.ai')
  assert.equal(readAccountStorage(KEY), 'team-a')
})

test('state from before accounts were kept apart goes to the first account only', () => {
  store.set(KEY, 'team-old')
  setStorageAccount('a@https://api.nuphos.ai')
  assert.equal(readAccountStorage(KEY), 'team-old')
  setStorageAccount('b@https://nuphos.example.com')
  assert.equal(readAccountStorage(KEY), null)
})
