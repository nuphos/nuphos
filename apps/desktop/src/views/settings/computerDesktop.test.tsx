import assert from 'node:assert/strict'

import { test } from 'bun:test'

const TEAM = '0123456789abcdef01234567'
const SENTINEL = '__ATLAS_API_ERROR__'

/** What the person reads after Open desktop on another computer, when opening it fails with `error`. */
async function shownFor(error: Error) {
  const { toastManager } = await import('../../components/ui/toast')
  const { openDesktop } = await import('./computerDesktop')
  const shown: { title: unknown; description: unknown }[] = []
  const add = toastManager.add.bind(toastManager)
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')

  toastManager.add = (options) => {
    shown.push({ title: options.title, description: options.description })

    return ''
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { api: { openSessionDesktop: () => Promise.reject(error) } },
  })
  try {
    openDesktop('device-1', TEAM, 'r1')
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    toastManager.add = add
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }

  return shown
}

/** An error from the backend as it crosses IPC (electron/atlas/error.ts). */
const refused = (code: string, message: string) =>
  new Error(
    `Error invoking remote method 'box:openSessionDesktop': Error: ${SENTINEL}${JSON.stringify({ code, message })}`,
  )

// #2947: each way Open desktop can fail tells the person why.
test('a Mac without Accessibility says so, and where to allow it', async () => {
  const reason =
    'Accessibility is not allowed for Nuphos yet. Allow it on this Mac in System Settings > Privacy & Security > Accessibility.'

  assert.deepEqual(await shownFor(refused('agent_instance_failed', reason)), [
    { title: 'Could not open the desktop', description: reason },
  ])
})

test('a Mac without Screen Recording, or whose screen host did not start, says so', async () => {
  for (const reason of [
    'Screen Recording is not allowed for Nuphos yet',
    'This Mac’s screen did not start in time.',
  ]) {
    assert.deepEqual(await shownFor(refused('agent_instance_failed', reason)), [
      { title: 'Could not open the desktop', description: reason },
    ])
  }
})

test('a computer that went offline or never answered says so', async () => {
  for (const [code, reason] of [
    ['runtime_offline', 'The computer disconnected before answering.'],
    ['agent_instance_timeout', 'The computer did not answer in time.'],
  ] as const) {
    assert.deepEqual(await shownFor(refused(code, reason)), [
      { title: 'Could not open the desktop', description: reason },
    ])
  }
})

test('a failure with no reason from the backend still shows one', async () => {
  assert.deepEqual(await shownFor(new Error('fetch failed')), [
    { title: 'Could not open the desktop', description: 'Check your connection and try again.' },
  ])
})
