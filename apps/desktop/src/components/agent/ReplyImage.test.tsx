import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

let resolve: () => Promise<unknown> = () => Promise.reject(new Error('unset'))

const dom = new Window()

const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { api } = await import('../../api')

Object.assign(api, { fileTransferResolve: () => resolve() })
const { ReplyImage } = await import('./ReplyImage')
const { createRoot } = await import('react-dom/client')

async function shown(fetch: () => Promise<unknown>) {
  resolve = fetch
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(async () => {
    root.render(createElement(ReplyImage, { groupId: 'group-1', teamId: 'team-1' }))
    await new Promise((done) => setTimeout(done, 0))
  })
  const text = container.textContent ?? ''
  const retry = [...container.querySelectorAll('button')].some((b) => b.textContent === 'Retry')

  await act(() => root.unmount())

  return { text, retry }
}

const atlasError = (code: string) =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'File transfer not found', code })}`)

// #3861: past 24 hours the backend deletes the group, and the reply offered a Retry that never works.
test('a file the backend no longer has reads as expired, with no Retry', async () => {
  const { text, retry } = await shown(() => Promise.reject(atlasError('transfer_not_found')))

  assert.match(text, /File expired — no longer available\./)
  assert.equal(retry, false)
})

test('an expired video says File, not Image', async () => {
  const { text } = await shown(async () => ({
    id: 'group-1',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    files: [
      {
        id: 'f',
        fileName: 'walkthrough.mp4',
        contentType: 'video/mp4',
        status: 'ready',
        size: 1,
        downloadUrl: 'https://example.test/v.mp4',
      },
    ],
  }))

  assert.match(text, /File expired — no longer available\./)
  assert.doesNotMatch(text, /Image expired/)
})

test('any other failure still offers Retry', async () => {
  const { retry } = await shown(() => Promise.reject(new Error('offline')))

  assert.equal(retry, true)
})
