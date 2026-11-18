import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, createRef } from 'react'

import type { VoicePhase } from './useVoiceDictation'

// The hook's state for the next render, and the transcript callback the composer gave it.
let phase: VoicePhase = { kind: 'idle' }
let land: (text: string, options: { send: boolean }) => void = () => {}
const stops: ({ send: boolean } | undefined)[] = []

mock.module('./useVoiceDictation', () => ({
  useVoiceDictation: (options: { onText: typeof land }) => {
    land = options.onText

    return {
      phase,
      elapsedMs: 2000,
      levels: [0.2, 0.8, 0.4],
      available: true,
      start: async () => {},
      stop: (options?: { send: boolean }) => stops.push(options),
      cancel: () => {},
      toggle: () => {},
    }
  },
}))

const dom = new Window()
const inserted: string[] = []

for (const [key, value] of Object.entries({
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  Node: dom.Node,
  // The strings module picks a language from it as it loads.
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, { configurable: true, value })
// happy-dom has no editing commands: record what the composer would type.
Object.defineProperty(dom.document, 'execCommand', {
  configurable: true,
  value: (_command: string, _ui: boolean, text: string) => inserted.push(text),
})

const { createRoot } = await import('react-dom/client')
const { ComposerVoice } = await import('./ComposerVoice')

/** The composer's card, its editor, and the voice control in its send row. */
async function composer(onSend: () => void) {
  const surface = dom.document.createElement('div')

  surface.className = 'relative composer-surface'
  const editor = dom.document.createElement('div')

  editor.setAttribute('contenteditable', 'true')
  const row = dom.document.createElement('div')

  surface.append(editor, row)
  dom.document.body.append(surface)
  const ref = createRef<HTMLDivElement>()

  ;(ref as { current: unknown }).current = editor
  const root = createRoot(row as unknown as HTMLElement)
  const render = () =>
    act(() =>
      root.render(createElement(ComposerVoice, { editor: ref, teamId: 't1', hero: false, onSend })),
    )

  await render()

  return { surface, row, render, unmount: () => act(() => root.unmount()) }
}

test('a take covers the whole composer with the recording bar, as on iOS', async () => {
  phase = { kind: 'idle' }
  const { surface, row, render, unmount } = await composer(() => {})

  assert.ok(row.querySelector('[aria-label="Voice input"]'), 'the microphone is in the send row')
  phase = { kind: 'recording', startedAt: 0 }
  await render()
  const bar = surface.querySelector('[role="group"][aria-label="Recording voice input"]')

  assert.ok(bar, 'a recording bar is shown')
  assert.equal(row.contains(bar), false, 'the bar covers the composer, not just its send row')
  assert.ok(bar.querySelector('[aria-label="Stop and send"]'), 'the bar has ↑')
  ;(bar.querySelector('[aria-label="Stop and send"]') as unknown as HTMLElement).click()
  assert.deepEqual(stops.at(-1), { send: true })
  phase = { kind: 'idle' }
  await unmount()
  surface.remove()
})

test('↑ puts the transcript at the caret and sends it; ■ only puts it there', async () => {
  phase = { kind: 'idle' }
  let sends = 0
  const { surface, unmount } = await composer(() => sends++)

  land('ship it', { send: false })
  assert.deepEqual(inserted.splice(0), ['ship it'])
  assert.equal(sends, 0)
  land('now', { send: true })
  assert.deepEqual(inserted.splice(0), ['now'])
  assert.equal(sends, 1)
  await unmount()
  surface.remove()
})
