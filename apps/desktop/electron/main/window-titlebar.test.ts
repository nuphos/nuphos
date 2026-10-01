import assert from 'node:assert/strict'
import test from 'node:test'

import { TITLEBAR_ROW_H, titleBarOverlayFor } from './window-titlebar.ts'

test('Linux gets native caption buttons in the custom titlebar', () => {
  assert.deepEqual(titleBarOverlayFor('linux'), {
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#9ca3af',
      height: TITLEBAR_ROW_H,
    },
  })
})

test('macOS keeps its traffic-light controls instead of an overlay', () => {
  assert.deepEqual(titleBarOverlayFor('darwin'), {})
})
