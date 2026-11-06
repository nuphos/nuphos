import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  MAX_SAVED_WINDOWS,
  accountKeyOf,
  accountWhenKnown,
  fitBoundsToDisplays,
  parseWindowSession,
  readWindowSession,
  restorableSurface,
  writeWindowSession,
} from './window-session-core.ts'

import type { AccountSource, SavedWindow } from './window-session-core.ts'

const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 }
const EXTERNAL = { x: 1512, y: 0, width: 2560, height: 1440 }

function saved(overrides: Partial<SavedWindow> = {}): SavedWindow {
  return {
    bounds: { x: 100, y: 100, width: 1200, height: 800 },
    maximized: false,
    fullScreen: false,
    account: 'https://api.nuphos.ai#user-1',
    surface: {
      layout: { direction: 'row', children: [{ id: 'primary' }, { id: 'pane-2' }] },
      activeId: 'pane-2',
      panes: { primary: pane('session-1'), 'pane-2': { ...pane('session-2'), dockOpen: true } },
    },
    ...overrides,
  }
}

function pane(sessionId: string | null) {
  return { sessionId, readOnly: false, teamId: 'team-1', mainPageOpen: false, dockOpen: false }
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
  const surface = {
    layout: { id: 'primary' },
    activeId: 'primary',
    panes: { primary: { sessionId: '../../etc', teamId: 7 } },
  }
  const parsed = parseWindowSession({ version: 1, windows: [saved({ surface } as never)] })

  assert.deepEqual(parsed.windows[0].surface?.panes.primary, { ...pane(null), teamId: null })
})

test('a surface saved before split panes restores as its one pane', () => {
  const legacy = { sessionId: 'session-1', readOnly: true, teamId: 'team-1', mainPageOpen: false }
  const parsed = parseWindowSession({ version: 1, windows: [saved({ surface: legacy } as never)] })

  assert.deepEqual(parsed.windows[0].surface, {
    layout: { id: 'primary' },
    activeId: 'primary',
    panes: { primary: { ...legacy, dockOpen: false } },
  })
})

const restoredSurface = (surface: unknown) =>
  parseWindowSession({ version: 1, windows: [saved({ surface } as never)] }).windows[0].surface

test('a split layout that is malformed or does not match its panes restores no surface', () => {
  const panes = { a: pane('s-a'), b: pane('s-b') }

  for (const layout of [
    { direction: 'diagonal', children: [{ id: 'a' }, { id: 'b' }] },
    { direction: 'row', children: [{ id: 'a' }] },
    { direction: 'row', children: [{ id: 'a' }, { id: 'a' }] },
    { direction: 'row', children: [{ id: 'a' }, { id: 'missing' }] },
    { direction: 'row', children: [{ id: 'a' }, { id: '../b' }] },
  ]) {
    assert.equal(restoredSurface({ layout, activeId: 'a', panes }), null, JSON.stringify(layout))
  }
  const proto = JSON.parse(
    '{"layout":{"id":"__proto__"},"activeId":"__proto__","panes":{"__proto__":{"sessionId":"s"}}}',
  ) as unknown

  assert.equal(
    Object.getOwnPropertyDescriptor(restoredSurface(proto)?.panes, '__proto__')?.value.sessionId,
    's',
  )
  assert.equal(Object.getPrototypeOf(restoredSurface(proto)?.panes), Object.prototype)
  assert.equal(restoredSurface({ layout: { id: 'toString' }, activeId: 'x', panes: {} }), null)
  const layout = { direction: 'column', children: [{ id: 'a' }, { id: 'b' }] }

  assert.equal(restoredSurface({ layout, activeId: 'gone', panes })?.activeId, 'a')
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

const API = 'https://api.nuphos.ai'

function sourceOf(settled: boolean, userId: string | null = null): AccountSource {
  return { settled: () => settled, context: () => ({ api: API, userId }) }
}

test('an account not yet in memory at take time is read from the stored sign-in', async () => {
  const account = await accountWhenKnown(sourceOf(false), () =>
    Promise.resolve({ token: 't', api: API, userInfo: { id: 'user-1' } }),
  )

  assert.equal(account, `${API}#user-1`)
  assert.deepEqual(restorableSurface(saved(), account), saved().surface)
})

test('once the session is set, memory wins and the file is not read', async () => {
  let reads = 0
  const account = await accountWhenKnown(sourceOf(true, 'user-2'), () => {
    reads += 1

    return Promise.resolve({ token: 't', api: API, userInfo: { id: 'user-1' } })
  })

  assert.equal(account, `${API}#user-2`)
  assert.equal(reads, 0)
})

test('a session set while the file was being read wins over the file', async () => {
  let settled = false
  const source: AccountSource = {
    settled: () => settled,
    context: () => ({ api: API, userId: settled ? 'user-2' : null }),
  }
  const account = await accountWhenKnown(source, () => {
    settled = true

    return Promise.resolve({ token: 't', api: API, userInfo: { id: 'user-1' } })
  })

  assert.equal(account, `${API}#user-2`)
})

test('no stored token, another backend or an unreadable file means no account', async () => {
  const stored = { api: API, userInfo: { id: 'user-1' } }

  assert.equal(await accountWhenKnown(sourceOf(false), () => Promise.resolve(stored)), null)
  assert.equal(
    await accountWhenKnown(sourceOf(false), () =>
      Promise.resolve({ ...stored, token: 't', api: 'https://self-hosted.example' }),
    ),
    null,
  )
  assert.equal(
    await accountWhenKnown(sourceOf(false), () => Promise.reject(new Error('locked'))),
    null,
  )
})
