import assert from 'node:assert/strict'
import { test } from 'node:test'

import { announceSavedSelection, onSavedSelection } from '../../../lib/savedCredentialSelection.ts'

import { adoptSavedSelection } from './adoptSavedSelection.ts'
import { credentialSelectionSignature, emptyCredentialAccess } from './credentialAccess.ts'

import type { Tab } from './model'
import type { AgentCredentialSelection } from '../../../api'

const tabOf = (sessionId: string) =>
  ({ id: `tab-${sessionId}`, sessionId, credentialAccess: emptyCredentialAccess() }) as Tab

function panel(tabs: Tab[]) {
  const state = { tabs }
  const refs = {
    credentialAccessRef: { current: new Map<string, AgentCredentialSelection>() },
    credentialSyncTimersRef: { current: new Map<string, ReturnType<typeof setTimeout>>() },
    credentialSyncVersionsRef: { current: new Map<string, number>() },
    lastCredentialSyncedRef: { current: new Map<string, string>() },
    setTabs: (next: Tab[] | ((prev: Tab[]) => Tab[])) => {
      state.tabs = typeof next === 'function' ? next(state.tabs) : next
    },
  }

  return { state, refs }
}

const gmail = { ...emptyCredentialAccess(), personalCredentialIds: ['gmail' as const] }

test("a selection saved in the Inbox reaches that conversation's open tab only", () => {
  const { state, refs } = panel([tabOf('asking'), tabOf('other')])
  const stop = onSavedSelection((saved) => adoptSavedSelection(refs as never, saved))

  announceSavedSelection({ sessionId: 'asking', credentialAccess: gmail })
  stop()
  assert.deepEqual(state.tabs[0]?.credentialAccess.personalCredentialIds, ['gmail'])
  assert.deepEqual(state.tabs[1]?.credentialAccess, emptyCredentialAccess())
  // Already saved: the panel does not send it back, and an older save of its own is dropped.
  assert.equal(
    refs.lastCredentialSyncedRef.current.get('asking'),
    credentialSelectionSignature(gmail),
  )
  assert.equal(refs.credentialSyncVersionsRef.current.get('asking'), 1)
})

test('a change made in the tab and not sent yet is kept', () => {
  const { state, refs } = panel([tabOf('asking')])

  // Its debounce timer is pending; only its presence matters here.
  refs.credentialSyncTimersRef.current.set('asking', 0 as never)
  adoptSavedSelection(refs as never, { sessionId: 'asking', credentialAccess: gmail })
  assert.deepEqual(state.tabs[0]?.credentialAccess, emptyCredentialAccess())
})
