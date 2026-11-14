import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SettingsSectionBody } from '../../views/settings/SettingsSectionBody'

import { ConnectorsDialog } from './ConnectorsDialog'
import { WorkspaceSessionPane } from './WorkspaceSessionPane'

import type { WorkspaceController } from './useWorkspaceController'
import type { UserInfo } from '../../types'

// No QueryClientProvider: a team-scoped query started without a team throws here.
const ws = { scope: undefined, connectorsDialog: {} } as unknown as WorkspaceController
const user = { id: 'me' } as UserInfo
const ignore = () => undefined

test('the session pane mounts nothing team-scoped without a team', () => {
  assert.equal(renderToStaticMarkup(createElement(WorkspaceSessionPane, { ws, user })), '')
})

test('the connectors dialog mounts nothing without a team', () => {
  assert.equal(renderToStaticMarkup(createElement(ConnectorsDialog, { ws, user })), '')
})

test('agent fallback settings mount only with a team', () => {
  const props = {
    section: 'preferences.runtimeFallback',
    team: undefined,
    user,
    onUserUpdated: ignore,
    onTeamUpdated: ignore,
    onTeamRemoved: ignore,
    onSignOut: ignore,
  }

  assert.equal(renderToStaticMarkup(createElement(SettingsSectionBody, props)), '')
})
