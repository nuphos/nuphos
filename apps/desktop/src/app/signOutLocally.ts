import { clearComposerDrafts } from '../components/agent/panel/composerDrafts'
import { clearClearedReplies } from '../components/agent/panel/composerReplyCleared'
import { resetAnalytics, track } from '../lib/analytics'

/**
 * What this window keeps of the account it signs out of: drafts, cleared
 * replies, the analytics identity. Runs before the main process signs out,
 * which reloads every window.
 */
export function signOutLocally(): void {
  clearComposerDrafts()
  clearClearedReplies()
  track('logout')
  resetAnalytics()
}
