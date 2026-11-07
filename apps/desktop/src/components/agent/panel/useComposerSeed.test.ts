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

test('an auto-send the composer refused lands in the editor with its files', () => {
  const box = composer()

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed({ filePaths: ['/Users/me/build.log'] }),
    onSend: () => false,
  })

  // The prompt and the files it came with are back in the composer, and nothing
  // was cleared: the user sends it themselves once the runtime can take it.
  assert.deepEqual(box.inserted(), ['review the failing build'])
  assert.deepEqual(box.files(), [['/Users/me/build.log']])
  assert.equal(box.cleared(), 0)
})

test('an auto-send the composer accepted leaves nothing in the editor', () => {
  const box = composer()

  useComposerSeed(box.state, {
    ...box.seed,
    readOnly: false,
    sendBlocked: false,
    streaming: false,
    pendingSeed: seed({ filePaths: ['/Users/me/build.log'] }),
    onSend: () => true,
  })

  assert.deepEqual(box.inserted(), [])
  assert.deepEqual(box.files(), [])
  assert.equal(box.cleared(), 1)
})
