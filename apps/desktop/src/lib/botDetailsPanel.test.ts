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

const { dismissBotDetails, isBotDetailsOpen, setBotDetailsOpen } =
  await import('./botDetailsPanel.ts')

test('Bot details start as the last Bot chat left them, and every Bot chat shares the choice', () => {
  assert.equal(isBotDetailsOpen('a'), true)

  setBotDetailsOpen(false)
  assert.equal(isBotDetailsOpen('a'), false)
  assert.equal(isBotDetailsOpen('b'), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '0')

  setBotDetailsOpen(true)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
})

test('a press outside the floating details closes them in that chat only, and saves nothing', () => {
  setBotDetailsOpen(true)
  dismissBotDetails('a')
  assert.equal(isBotDetailsOpen('a'), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
  // The next Bot chat opens as saved; so does this one when it is opened again.
  assert.equal(isBotDetailsOpen('b'), true)
  setBotDetailsOpen(true)
  assert.equal(isBotDetailsOpen('a'), true)
})
