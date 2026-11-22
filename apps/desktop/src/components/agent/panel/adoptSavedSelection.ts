import { useEffect } from 'react'

import { onSavedSelection } from '../../../lib/savedCredentialSelection.ts'

import { credentialSelectionSignature } from './credentialAccess.ts'

import type { PanelCtx } from './ctx'
import type { SavedSelection } from '../../../lib/savedCredentialSelection.ts'

type Refs = Pick<
  PanelCtx,
  | 'credentialAccessRef'
  | 'credentialSyncTimersRef'
  | 'credentialSyncVersionsRef'
  | 'lastCredentialSyncedRef'
  | 'setTabs'
>

/**
 * Takes a selection saved elsewhere into the open tab of that conversation, so
 * its picker and Connect cards show it and its next turn sends it. A change made
 * here and not sent yet wins: it goes out after.
 */
export function adoptSavedSelection(refs: Refs, { sessionId, credentialAccess }: SavedSelection) {
  if (refs.credentialSyncTimersRef.current.has(sessionId)) return
  const versions = refs.credentialSyncVersionsRef.current

  // A save of this tab's that answers later is older than this one.
  versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1)
  refs.credentialAccessRef.current.set(sessionId, credentialAccess)
  refs.lastCredentialSyncedRef.current.set(
    sessionId,
    credentialSelectionSignature(credentialAccess),
  )
  refs.setTabs((tabs) =>
    tabs.map((tab) => (tab.sessionId === sessionId ? { ...tab, credentialAccess } : tab)),
  )
}

/** "Use in task" in the Inbox saves the asking conversation's selection without the panel. */
export function useSavedSelections(refs: Refs) {
  const {
    credentialAccessRef,
    credentialSyncTimersRef,
    credentialSyncVersionsRef,
    lastCredentialSyncedRef,
    setTabs,
  } = refs

  useEffect(
    () =>
      onSavedSelection((saved) =>
        adoptSavedSelection(
          {
            credentialAccessRef,
            credentialSyncTimersRef,
            credentialSyncVersionsRef,
            lastCredentialSyncedRef,
            setTabs,
          },
          saved,
        ),
      ),
    [
      credentialAccessRef,
      credentialSyncTimersRef,
      credentialSyncVersionsRef,
      lastCredentialSyncedRef,
      setTabs,
    ],
  )
}
