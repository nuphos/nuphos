import { clearComposerDrafts } from '../components/agent/panel/composerDrafts'
import { clearClearedReplies } from '../components/agent/panel/composerReplyCleared'
import { activeTeam, identifyUser, resetAnalytics, setActiveTeam, track } from '../lib/analytics'

import { readLocalStorage, writeLocalStorage } from './localStorage'

import type { UserInfo } from '../types'

// Both stores live only in localStorage, so a copy restores them whole.
const KEPT = ['nuphos.agent.composerDrafts.v1', 'nuphos.agent.clearedReplies.v1']

/**
 * What this window keeps of the account it signs out of: drafts, cleared
 * replies, the analytics identity. Runs before the main process signs out,
 * which reloads every window. Returns how to put it all back if that sign-out
 * fails and the account stays signed in.
 */
export function signOutLocally(): (user: UserInfo) => void {
  // Best effort, like the stores themselves: storage that throws never blocks a sign-out.
  const kept = KEPT.map((key) => [key, readLocalStorage(key)] as const)
  const team = activeTeam()

  clearComposerDrafts()
  clearClearedReplies()
  track('logout')
  resetAnalytics()

  return (user) => {
    for (const [key, value] of kept) if (value !== null) writeLocalStorage(key, value)
    identifyUser(user)
    setActiveTeam(team)
  }
}
