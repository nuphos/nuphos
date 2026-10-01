import { expect, test } from 'bun:test'

import { withTranscriptWriteLock } from './transcript-write-lock'

test('serializes a transcript read-modify-write behind an in-flight full sync', async () => {
  const events: string[] = []
  let releaseFirst: (() => void) | undefined
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const first = withTranscriptWriteLock('session-1', 'owner-1', async () => {
    events.push('full-sync:start')
    await firstHeld
    events.push('full-sync:end')
  })
  const append = withTranscriptWriteLock('session-1', 'owner-1', () => {
    events.push('autonomous:read-latest')

    return Promise.resolve()
  })

  await Bun.sleep(0)
  expect(events).toEqual(['full-sync:start'])
  releaseFirst?.()
  await Promise.all([first, append])
  expect(events).toEqual(['full-sync:start', 'full-sync:end', 'autonomous:read-latest'])
})

test('does not serialize unrelated conversations', async () => {
  const events: string[] = []
  let releaseFirst: (() => void) | undefined
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const first = withTranscriptWriteLock('session-1', 'owner-1', async () => {
    events.push('one:start')
    await firstHeld
  })
  const second = withTranscriptWriteLock('session-2', 'owner-1', () => {
    events.push('two:start')

    return Promise.resolve()
  })

  await Bun.sleep(0)
  expect(events).toEqual(['one:start', 'two:start'])
  releaseFirst?.()
  await Promise.all([first, second])
})
