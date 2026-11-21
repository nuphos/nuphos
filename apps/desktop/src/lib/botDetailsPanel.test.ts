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

const { dismissBotDetails, isBotDetailsOpen, setBotDetailsNarrow, setBotDetailsOpen } =
  await import('./botDetailsPanel.ts')

test('Bot details start as the last Bot chat left them, and every Bot chat shares the choice', () => {
  assert.equal(isBotDetailsOpen('a'), true)

  setBotDetailsOpen('a', false)
  assert.equal(isBotDetailsOpen('a'), false)
  assert.equal(isBotDetailsOpen('b'), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '0')

  setBotDetailsOpen('a', true)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
})

test('a press outside the floating details closes them in that chat only, and saves nothing', () => {
  setBotDetailsOpen('a', true)
  dismissBotDetails('a')
  assert.equal(isBotDetailsOpen('a'), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
  // The next Bot chat opens as saved; so does this one when it is opened again.
  assert.equal(isBotDetailsOpen('b'), true)
  setBotDetailsOpen('a', true)
  assert.equal(isBotDetailsOpen('a'), true)
})

test('with no room beside, the details close and open only as a look, keeping the saved choice', () => {
  setBotDetailsOpen('a', true)
  // Narrowing closes them, without saving that.
  setBotDetailsNarrow('a', true)
  assert.equal(isBotDetailsOpen('a'), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
  // Opened by hand, they show in this chat only, and closing them saves nothing either.
  setBotDetailsOpen('a', true)
  assert.equal(isBotDetailsOpen('a'), true)
  setBotDetailsOpen('a', false)
  assert.equal(isBotDetailsOpen('a'), false)
  assert.equal(values.get('nuphos.botDetailsOpen'), '1')
  // A press outside or the mouse leaving closes the look too.
  setBotDetailsOpen('a', true)
  dismissBotDetails('a')
  assert.equal(isBotDetailsOpen('a'), false)
  // Wide again, they are back beside the chat as saved, with nothing opened by hand.
  setBotDetailsNarrow('a', false)
  assert.equal(isBotDetailsOpen('a'), true)
  // A look left open does not outlive the narrow chat either.
  setBotDetailsNarrow('a', true)
  setBotDetailsOpen('a', true)
  setBotDetailsNarrow('a', false)
  assert.equal(isBotDetailsOpen('a'), true)
  setBotDetailsNarrow('a', true)
  assert.equal(isBotDetailsOpen('a'), false)
  setBotDetailsNarrow('a', false)
  assert.equal(isBotDetailsOpen('a'), true)
})
