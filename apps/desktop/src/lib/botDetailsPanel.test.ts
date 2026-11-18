import assert from 'node:assert/strict'
import { test } from 'node:test'

const values = new Map<string, string>([['nuphos.botDetailsOpen', '1']])

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
})

const { isBotDetailsOpen, setBotDetailsOpen } = await import('./botDetailsPanel.ts')

test('Bot details start as the last Bot chat left them, and every Bot chat shares the choice', () => {
  assert.equal(isBotDetailsOpen(), true)

  setBotDetailsOpen(false)
  assert.equal(isBotDetailsOpen(), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '0')

  setBotDetailsOpen(true)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
})
