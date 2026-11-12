import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FILE_PREVIEW_FRAME_NAME as RENDERER_NAME } from '../../src/components/agent/artifacts/filePreviewFrameName.ts'

import { FILE_PREVIEW_FRAME_NAME, blocksFilePreviewNavigation } from './file-preview-guard.ts'

const preview = { isMainFrame: false, frameName: FILE_PREVIEW_FRAME_NAME }

test('the guard and the renderer name the same frame', () => {
  assert.equal(FILE_PREVIEW_FRAME_NAME, RENDERER_NAME)
})

test('a file preview frame never navigates to the web', () => {
  assert.equal(blocksFilePreviewNavigation({ ...preview, url: 'https://example.com/' }), true)
  assert.equal(blocksFilePreviewNavigation({ ...preview, url: 'file:///etc/passwd' }), true)
  assert.equal(blocksFilePreviewNavigation({ ...preview, url: 'data:text/html,hi' }), true)
})

test('it still loads its own document', () => {
  assert.equal(blocksFilePreviewNavigation({ ...preview, url: 'about:srcdoc' }), false)
  assert.equal(blocksFilePreviewNavigation({ ...preview, url: 'about:blank' }), false)
})

test('other frames and the app itself are left alone', () => {
  const url = 'https://example.com/'

  assert.equal(blocksFilePreviewNavigation({ isMainFrame: false, frameName: '', url }), false)
  assert.equal(blocksFilePreviewNavigation({ isMainFrame: true, frameName: undefined, url }), false)
  assert.equal(
    blocksFilePreviewNavigation({ isMainFrame: true, frameName: FILE_PREVIEW_FRAME_NAME, url }),
    false,
  )
})
