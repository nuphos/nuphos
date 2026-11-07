import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import type { AgentPromptSeed } from './model'
import type { ComposerState } from './useComposerState'

// Run the seed effect as the hook mounts; its body is what this covers, and a
// re-render is what the real scheduler adds on top.
mock.module('react', {
  namedExports: {
    useEffect: (effect: () => void) => {
      effect()
    },
  },
})

// The seed lands in the editor after a frame, so nothing is inserted into a
// composer the user is still typing into. Here the frame is immediate.
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: (time: number) => void) => {
    callback(0)

    return 0
  },
})

const { useComposerSeed } = await import('./useComposerSeed.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))

function composer() {
  const inserted: string[] = []
  const files: string[][] = []
  let cleared = 0

  const state = {
    seedAlreadySeen: () => false,
    setFilePaths: (update: string[] | ((prev: string[]) => string[])) => {
      files.push(typeof update === 'function' ? update([]) : update)
    },
    clearEditor: () => {
      cleared++
    },
  } as unknown as ComposerState

  return {
    state,
    inserted: () => inserted,
    files: () => files,
    cleared: () => cleared,
    seed: {
      onSeedConsumed: () => {},
      clearDraft: () => {
        cleared++
      },
      insertText: (text: string) => inserted.push(text),
      insertMention: (text: string) => inserted.push(`@${text}`),
    },
  }
}

const seed = (over: Partial<AgentPromptSeed> = {}): AgentPromptSeed => ({
  text: 'review the failing build',
  nonce: 1,
  autoSend: true,
  ...over,
})

test('an auto-send the composer refused lands in the editor with its files', async () => {
  const box = composer()
  let consumed = 0

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed({ filePaths: ['/Users/me/build.log'] }),
    onSend: () => Promise.resolve(false),
    onSeedConsumed: () => {
      consumed++
    },
  })
  // The refusal comes back in a microtask, as the composer's own answer does.
  await settle()

  // The prompt and the files it came with are back in the composer, and nothing
  // was cleared: the user sends it themselves once the runtime can take it.
  assert.deepEqual(box.inserted(), ['review the failing build'])
  assert.deepEqual(box.files(), [['/Users/me/build.log']])
  assert.equal(box.cleared(), 0)
  assert.equal(consumed, 1)
})

test('an auto-send the composer accepted leaves nothing in the editor', async () => {
  const box = composer()
  let consumed = 0

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed({ filePaths: ['/Users/me/build.log'] }),
    onSend: () => Promise.resolve(true),
    onSeedConsumed: () => {
      consumed++
    },
  })
  await settle()

  assert.deepEqual(box.inserted(), [])
  assert.deepEqual(box.files(), [])
  assert.equal(box.cleared(), 1)
  assert.equal(consumed, 1)
})

test('an auto-send that failed lands in the editor too, and is not retried', async () => {
  const box = composer()
  let sends = 0

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed(),
    onSend: () => {
      sends++

      return Promise.reject(new Error('offline'))
    },
  })
  await settle()

  assert.equal(sends, 1)
  assert.deepEqual(box.inserted(), ['review the failing build'])
  assert.equal(box.cleared(), 0)
})

test('an auto-send waits while the agent is still streaming', () => {
  const box = composer()
  let sends = 0

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: true,
    pendingSeed: seed(),
    onSend: () => {
      sends++

      return Promise.resolve(true)
    },
  })

  // The seed stays pending: the effect runs again when the turn ends.
  assert.equal(sends, 0)
  assert.deepEqual(box.inserted(), [])
})

test('an auto-send waits while the composer is blocked', () => {
  const box = composer()
  let sends = 0

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: true,
    streaming: false,
    pendingSeed: seed(),
    onSend: () => {
      sends++

      return Promise.resolve(true)
    },
  })

  assert.equal(sends, 0)
  assert.deepEqual(box.inserted(), [])
})

test('a seed that opens in the chat replaces the editor and mentions as asked', () => {
  const box = composer()

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed({ autoSend: false, replace: true, mode: 'mention' }),
    onSend: () => Promise.resolve(true),
  })

  assert.equal(box.cleared(), 1)
  assert.deepEqual(box.inserted(), ['@review the failing build'])
})

test('a seed already consumed by this composer is not applied twice', () => {
  const box = composer()
  const state = { ...box.state, seedAlreadySeen: () => true } as unknown as ComposerState

  useComposerSeed(state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed(),
    onSend: () => Promise.resolve(false),
  })

  assert.deepEqual(box.inserted(), [])
  assert.equal(box.cleared(), 0)
})
