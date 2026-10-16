import assert from 'node:assert/strict'
import test from 'node:test'

import { desktopsFromRuntimeState } from '../components/agent/panel/shells.ts'

import {
  desktopTabId,
  planDesktopTabs,
  publishSessionDesktops,
  sessionDesktopTitle,
} from './sessionDesktops.ts'

const tabsOf = (tabs: Record<string, { id: string; active: string }[]>) => (sessionId: string) =>
  tabs[sessionId] ?? []
const d = (display: number) => ({ display, title: `Box 1 · :${String(display)}` })

test('opens a tab for each desktop asked for that has none, and closes the ones a session lost', () => {
  const sessions = new Map([
    ['s1', { teamId: 't', desktops: [d(2), d(4)] }],
    ['s2', { teamId: 't', desktops: [] }],
  ])
  const plan = planDesktopTabs(
    sessions,
    tabsOf({
      s1: [
        { id: desktopTabId('s1', 2), active: 'team.desktop' },
        { id: desktopTabId('s1', 3), active: 'team.desktop' },
        // Navigated elsewhere by the user: no longer a desktop tab, so left alone.
        { id: desktopTabId('s1', 5), active: 'team.files' },
      ],
      s2: [{ id: desktopTabId('s2', 2), active: 'team.desktop' }],
      // Not published (its chat is off screen): untouched even though it has a desktop tab.
      s3: [{ id: desktopTabId('s3', 2), active: 'team.desktop' }],
    }),
    [
      { sessionId: 's1', display: 2 },
      { sessionId: 's1', display: 4 },
      // Its session is not published: no team to open it in.
      { sessionId: 's3', display: 7 },
    ],
  )

  assert.deepEqual(plan, {
    open: [{ sessionId: 's1', teamId: 't', display: 4 }],
    close: [desktopTabId('s1', 3), desktopTabId('s2', 2)],
  })
})

test('a desktop is labelled with its Box and display from the snapshot', () => {
  const desktops = desktopsFromRuntimeState({
    state: 'idle',
    tools: [{ id: 'desktop:3', title: 'Box 1 · :3', desktop: { display: 3, deviceId: 'b1' } }],
  } as Parameters<typeof desktopsFromRuntimeState>[0])

  publishSessionDesktops('s9', { teamId: 't', desktops })
  assert.equal(sessionDesktopTitle('s9', 3), 'Box 1 · :3')
  assert.equal(sessionDesktopTitle('s9', 4), undefined)
  publishSessionDesktops('s9', null)
})
