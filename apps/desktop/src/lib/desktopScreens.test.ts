import assert from 'node:assert/strict'
import test from 'node:test'

import { desktopFilter, desktopScreens, parseDesktopFilter } from './desktopScreens.ts'

test("a desktop tab's route names the Box and, past :1, the display and its conversation", () => {
  const screen = { display: 3, sessionId: 's-1' }

  assert.deepEqual(parseDesktopFilter('7'), { kind: 'session', display: 7 })
  assert.deepEqual(parseDesktopFilter('box-1'), { kind: 'box', deviceId: 'box-1' })
  assert.deepEqual(parseDesktopFilter(desktopFilter('box-1', screen)), {
    kind: 'box',
    deviceId: 'box-1',
    screen,
  })
  assert.equal(desktopFilter('box-1'), 'box-1')
})

test("the switcher lists the Box's own desktop first, then the viewer's sessions there", () => {
  const device = {
    deviceId: 'box-1',
    label: 'Box 1',
    desktops: [
      { display: 2, sessionId: 's-a', title: 'Fix login' },
      { display: 3, sessionId: 's-b', title: '' },
    ],
  }

  assert.deepEqual(desktopScreens(device, 'box-1'), [
    { value: 'box-1', label: 'Box 1 · :1' },
    { value: 'box-1:2:s-a', label: ':2 · Fix login' },
    { value: 'box-1:3:s-b', label: ':3 · Agent' },
  ])
  assert.deepEqual(desktopScreens(undefined, 'box-1'), [{ value: 'box-1', label: 'Computer · :1' }])
})
