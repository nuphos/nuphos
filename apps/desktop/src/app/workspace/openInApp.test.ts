import assert from 'node:assert/strict'
import { test } from 'node:test'

import { navigationFromAppPath } from '../../lib/appRoutes.ts'
import { openBoxDesktop } from '../../views/settings/boxDesktop.ts'
import { createWorkspaceTabFromNavigation } from '../workspaceTabFactory.ts'

import { listenOpenInApp } from './openInApp.ts'
import { createWorkspaceState, selectAllResidentTabs } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'

globalThis.window ??= new EventTarget() as Window & typeof globalThis

const pane = (sessionId: string) =>
  createWorkspaceStore({ ...createWorkspaceState(), teamsKnown: true, sessionId })

const desktopTabs = (store: ReturnType<typeof pane>) =>
  selectAllResidentTabs(store.getState()).filter((tab) => tab.active === 'team.desktop')

test('opening a Box desktop with several panes moves only the focused pane', () => {
  const stores = new Map(['a', 'b', 'c', 'd'].map((id) => [id, pane(`task-${id}`)]))
  // Each pane opens a link as a tab of its own, as its Workspace does.
  const openers = new Map(
    [...stores].map(([id, store]) => [
      id,
      (href: string) => {
        const navigation = navigationFromAppPath(href)

        assert.ok(navigation)
        store.actions.openTab(createWorkspaceTabFromNavigation(navigation))
      },
    ]),
  )
  const stop = listenOpenInApp(openers, 'c')

  try {
    openBoxDesktop('device-1', '0123456789abcdef01234567')
  } finally {
    stop()
  }

  assert.deepEqual(
    [...stores].map(([id, store]) => [id, desktopTabs(store).length]),
    [
      ['a', 0],
      ['b', 0],
      ['c', 1],
      ['d', 0],
    ],
  )
  // Every pane still shows its own Task.
  assert.deepEqual(
    [...stores.values()].map((store) => store.getState().sessionId),
    ['task-a', 'task-b', 'task-c', 'task-d'],
  )
})

test('a link asked for after the listener stops opens nowhere', () => {
  const opened: string[] = []
  const stop = listenOpenInApp(new Map([['a', (href: string) => opened.push(href)]]), 'a')

  stop()
  openBoxDesktop('device-1', '0123456789abcdef01234567')
  assert.deepEqual(opened, [])
})
