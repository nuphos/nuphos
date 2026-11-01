import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  MAX_SAVED_WINDOWS,
  accountKeyOf,
  fitBoundsToDisplays,
  parseWindowSession,
  readWindowSession,
  restorableSurface,
  writeWindowSession,
} from './window-session-core.ts'

import type { SavedWindow } from './window-session-core.ts'

const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 }
const EXTERNAL = { x: 1512, y: 0, width: 2560, height: 1440 }

function saved(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    maximized: false,
    fullScreen: false,
    account: 'https://api.nuphos.ai#user-1',
    surface: { sessionId: 'session-1', readOnly: false, teamId: 'team-1', mainPageOpen: false },
    ...overrides,
  }
}

test('bounds on a connected display are kept as they were', () => {
  const bounds = { x: 1800, y: 200, width: 1600, height: 1000 }

  assert.deepEqual(fitBoundsToDisplays(bounds, [LAPTOP, EXTERNAL], LAPTOP), bounds)
})

test('a window left on an unplugged monitor comes back centred on the primary display', () => {
  const bounds = { x: 1800, y: 200, width: 2400, height: 1300 }

  assert.deepEqual(fitBoundsToDisplays(bounds, [LAPTOP], LAPTOP), { width: 1512, height: 920 })
})

test('a window barely peeking onto a display counts as off screen', () => {
  const bounds = { x: 1500, y: 200, width: 1200, height: 800 }

  assert.equal(fitBoundsToDisplays(bounds, [LAPTOP], LAPTOP).x, undefined)
})

test('a titlebar above the work area is pulled back below the menu bar', () => {
  const fitted = fitBoundsToDisplays({ x: 100, y: -10, width: 1200, height: 800 }, [LAPTOP], LAPTOP)

  assert.equal(fitted.y, LAPTOP.y)
})

test('a window larger than its display shrinks to fit it', () => {
  const fitted = fitBoundsToDisplays({ x: 0, y: 25, width: 3000, height: 2000 }, [LAPTOP], LAPTOP)

  assert.deepEqual([fitted.width, fitted.height], [LAPTOP.width, LAPTOP.height])
})

test('only the account that saved a surface gets it back', () => {
  const window = saved()

  assert.deepEqual(restorableSurface(window, 'https://api.nuphos.ai#user-1'), window.surface)
  assert.equal(restorableSurface(window, 'https://api.nuphos.ai#user-2'), null)
  assert.equal(restorableSurface(window, 'https://self-hosted.example#user-1'), null)
  assert.equal(restorableSurface(window, null), null)
  assert.equal(restorableSurface({ ...window, account: null }, null), null)
})

test('the account key needs a signed-in user', () => {
  assert.equal(accountKeyOf('https://api.nuphos.ai', null), null)
  assert.equal(accountKeyOf('https://api.nuphos.ai', 'u'), 'https://api.nuphos.ai#u')
})

test('a damaged or foreign file restores nothing instead of failing', () => {
  assert.deepEqual(parseWindowSession('nope').windows, [])
  assert.deepEqual(parseWindowSession({ version: 2, windows: [saved()] }).windows, [])
  assert.deepEqual(
    parseWindowSession({ version: 1, windows: [{ bounds: { x: 0, y: 0, width: -1, height: 1 } }] })
      .windows,
    [],
  )
})

test('surface ids that could not have come from the app are dropped', () => {
  const parsed = parseWindowSession({
    version: 1,
    windows: [saved({ surface: { sessionId: '../../etc', teamId: 7 } as never })],
  })

  assert.deepEqual(parsed.windows[0].surface, {
    sessionId: null,
    readOnly: false,
    teamId: null,
    mainPageOpen: false,
  })
})

test('the number of windows reopened is capped', () => {
  const windows = Array.from({ length: MAX_SAVED_WINDOWS + 5 }, () => saved())

  assert.equal(parseWindowSession({ version: 1, windows }).windows.length, MAX_SAVED_WINDOWS)
})

test('a session written to disk reads back the same', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuphos-window-session-'))
  const file = path.join(root, 'nested', 'window-session.json')

  try {
    assert.deepEqual(readWindowSession(file).windows, [])
    const session = { version: 1 as const, windows: [saved(), saved({ maximized: true })] }

    writeWindowSession(file, session)
    assert.deepEqual(readWindowSession(file), session)
    assert.equal(fs.existsSync(`${file}.tmp`), false)
  } finally {
    fs.rmSync(root, { recursive: true })
  }
})
