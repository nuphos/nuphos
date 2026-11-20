import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useEffect } from 'react'

type Toast = {
  title: unknown
  description: unknown
  action?: { label: string; onClick: () => void }
}

const toasts: Toast[] = []
const opened: string[] = []
let transcribe: () => Promise<{ text: string; language: string | null }> = async () => ({
  text: '',
  language: null,
})

mock.module('../../../api', () => ({ api: { voiceTranscribe: () => transcribe() } }))
mock.module('../../../app/workspace/openInApp', () => ({
  openInApp: (href: string) => opened.push(href),
}))
mock.module('../../ui/toast', () => ({
  toast: {
    error: (title: unknown, description?: unknown, opts?: { action?: Toast['action'] }) =>
      toasts.push({ title, description, action: opts?.action }),
    apiError: (title: unknown, err: unknown) => toasts.push({ title, description: String(err) }),
    info: (title: unknown, description?: unknown) => toasts.push({ title, description }),
  },
}))

const dom = new Window()
let microphoneOpens = 0

class FakeRecorder {
  static readonly isTypeSupported = () => true
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio']) })
    this.onstop?.()
  }
}

for (const [key, value] of Object.entries({
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  MediaRecorder: FakeRecorder,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, { configurable: true, value })
Object.defineProperty(dom.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia: async () => {
      microphoneOpens++

      return { getTracks: () => [{ stop: () => {} }] }
    },
  },
})

const { createRoot } = await import('react-dom/client')
const { useVoiceDictation } = await import('./useVoiceDictation')

// The hook's latest return, for the test to drive.
const probe: { voice?: ReturnType<typeof useVoiceDictation> } = {}

function Probe() {
  const voice = useVoiceDictation({ teamId: 't1', onText: () => {} })

  useEffect(() => {
    probe.voice = voice
  })

  return null
}

/** The backend's refusal as it reaches the renderer: the atlas sentinel and its JSON. */
const subscriptionRequired = new Error(
  `__ATLAS_API_ERROR__${JSON.stringify({ code: 'subscription_required', message: 'Voice input is included with a Nuphos subscription.' })}`,
)

test('a team without a subscription is told so, with Upgrade, and is not asked to record again', async () => {
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)

  await act(() => root.render(createElement(Probe)))
  transcribe = () => Promise.reject(subscriptionRequired)
  await act(() => probe.voice?.start())
  assert.equal(microphoneOpens, 1)
  await act(async () => {
    probe.voice?.stop()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, 'Voice input needs a subscription')
  assert.equal(toasts[0].action?.label, 'Upgrade')
  toasts[0].action?.onClick()
  assert.deepEqual(opened, ['/teams/t1/settings/billing'])

  // Now that the app knows, the microphone does not open for a take that would be refused.
  await act(() => probe.voice?.start())
  assert.equal(microphoneOpens, 1, 'no second recording')
  assert.equal(probe.voice?.phase.kind, 'idle')
  assert.equal(toasts.length, 2)
  assert.equal(toasts[1].title, 'Voice input needs a subscription')
  await act(() => root.unmount())
})
