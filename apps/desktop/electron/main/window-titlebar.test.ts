import assert from 'node:assert/strict'
import test from 'node:test'

import { TITLEBAR_ROW_H, TITLEBAR_TOP_INSET, titleBarOverlayFor } from './window-titlebar.ts'

test('Linux gets native caption buttons centred on the inset titlebar row', () => {
  assert.deepEqual(titleBarOverlayFor('linux'), {
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#9ca3af',
      height: TITLEBAR_ROW_H + 2 * TITLEBAR_TOP_INSET,
    },
  })
})

test('macOS keeps its traffic-light controls instead of an overlay', () => {
  assert.deepEqual(titleBarOverlayFor('darwin'), {})
})
