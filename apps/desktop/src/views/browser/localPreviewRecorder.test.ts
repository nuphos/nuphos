import assert from 'node:assert/strict'
import { test } from 'node:test'

import { localPreviewSnapshots } from '../../components/agent/panel/localPreviewSnapshots.ts'

import { localPreviewRecorder } from './localPreviewRecorder.ts'

import type { NativeImage, WebviewTag } from 'electron'

const scope = { userId: 'viewer', teamId: 'example-team' }
const href = 'http://localhost:5173/preview'
const image = {
  isEmpty: () => false,
  getSize: () => ({ width: 1200, height: 800 }),
  resize: () => ({ toDataURL: () => 'data:image/png;base64,bmV1dHJhbCBpbWFnZQ==' }),
} as unknown as NativeImage

function page(capturePage = async () => image) {
  return { getURL: () => href, getTitle: () => 'Example page', capturePage } as Pick<
    WebviewTag,
    'getURL' | 'getTitle' | 'capturePage'
  >
}

test('a completed local-page capture is available only while its browser owner is alive', async () => {
  const recorder = localPreviewRecorder(page(), scope)

  try {
    await recorder.capture()
    assert.equal(localPreviewSnapshots.get(scope, href)?.title, 'Example page')
  } finally {
    recorder.dispose()
  }
  assert.equal(localPreviewSnapshots.get(scope, href), undefined)
})

test('navigation and unmount invalidate an in-flight capture', async () => {
  for (const change of ['navigation', 'unmount']) {
    let finish!: (value: NativeImage) => void
    const pending = new Promise<NativeImage>((resolve) => {
      finish = resolve
    })
    const recorder = localPreviewRecorder(
      page(() => pending),
      scope,
    )
    const capture = recorder.capture()

    if (change === 'navigation') recorder.invalidate()
    else recorder.dispose()
    finish(image)
    await capture
    assert.equal(localPreviewSnapshots.get(scope, href), undefined)
    recorder.dispose()
  }
})

test('remote pages and missing identity never invoke capturePage', async () => {
  let captures = 0
  const view = page(async () => {
    captures += 1

    return image
  })

  await localPreviewRecorder(view).capture()
  await localPreviewRecorder({ ...view, getURL: () => 'https://example.com' }, scope).capture()
  assert.equal(captures, 0)
})

test('a closed or offscreen webview leaves a usable link without an image', async () => {
  const recorder = localPreviewRecorder(
    page(async () => {
      throw new Error('Closed guest')
    }),
    scope,
  )

  await recorder.capture()
  assert.equal(localPreviewSnapshots.get(scope, href), undefined)
  recorder.dispose()
})

test('SPA routes, hashes and back navigation replace the exact-page snapshot', async () => {
  let current = href
  let captures = 0
  const view = {
    ...page(async () => {
      captures += 1

      return image
    }),
    getURL: () => current,
  }
  const recorder = localPreviewRecorder(view, scope)

  try {
    await recorder.capture()
    for (const next of [`${href}/details`, `${href}/details#controls`, href]) {
      const previous = current

      current = next
      await recorder.navigatedInPage(true)
      assert.equal(localPreviewSnapshots.get(scope, previous), undefined)
      assert.equal(localPreviewSnapshots.get(scope, next)?.title, 'Example page')
    }
    const previous = current

    current = `${href}/hidden`
    await recorder.navigatedInPage(false)
    assert.equal(captures, 4)
    assert.equal(localPreviewSnapshots.get(scope, previous), undefined)
    assert.equal(localPreviewSnapshots.get(scope, current), undefined)
  } finally {
    recorder.dispose()
  }
})
