import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { ASK_ADMIN_TO_RECONNECT } from './AgentSetupRequiredCard'
import { ConversationActivityBadges } from './historyRows'
import { selectedAgentSignOut } from './RuntimeSelector'
import { slackThreadFallbackUrl } from './slackThreadUrl'

import type { RuntimeControl } from './RuntimeSelector'
import type { AgentConversation, AgentSlackThread } from '../../../api'

export function ReadOnlyConversationNotice({
  activitySource,
  slackThread,
  label,
}: {
  activitySource?: AgentConversation['activitySource']
  slackThread?: AgentSlackThread | null
  // Overrides the default read-only copy — e.g. the gated "connect an
  // integration" guidance, which would otherwise be hidden behind this notice.
  label?: string
}) {
  return (
    <div className="flex min-h-9 min-w-0 items-center gap-2">
      <ConversationActivityBadges source={activitySource} />
      <span className="min-w-0 truncate text-[13px] text-secondary">
        {label ?? conversationReadOnlyLabel(activitySource, Boolean(slackThread))}
      </span>
      {slackThread && <span className="sr-only">Use the Open thread button to reply.</span>}
    </div>
  )
}

export function OpenSlackThreadButton({ thread }: { thread: AgentSlackThread }) {
  const [opening, setOpening] = useState(false)
  const threadUrl = thread.url ?? slackThreadFallbackUrl(thread)

  const openThread = useCallback(() => {
    if (opening) return
    setOpening(true)
    api
      .appOpenExternal(threadUrl)
      .catch((err: unknown) => {
        toast.apiError('Failed to open Slack thread', err)
      })
      .finally(() => setOpening(false))
  }, [opening, threadUrl])

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={openThread}
      disabled={opening}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium disabled:cursor-wait disabled:opacity-60"
      title="Open the linked Slack thread"
      aria-label="Open the linked Slack thread"
    >
      {opening ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      ) : (
        <FontAwesomeIcon icon={faSlack} className="h-3 w-3" />
      )}
      <span>Open thread</span>
      <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
    </Button>
  )
}

/** Said before the message goes, not after it fails: every turn on a signed-out
 *  agent dies in its first seconds. A managed agent's composer also stops sending. */
export function SignedOutAgentNotice({ control }: { control: RuntimeControl }) {
  const { value, canUpdateTeamAgents: isTeamAdmin } = control
  const signOut = selectedAgentSignOut(control)
  // Only an administrator can sign a team agent back in; a member gets the same
  // instruction the reauthentication card gives after a failed turn.
  const onSettings = isTeamAdmin ? control.onSettings : undefined

  if (!value || !signOut) return null

  return (
    <div
      role="status"
      className="mb-1.5 flex min-w-0 items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[12.5px] text-secondary"
    >
      <KeyRound aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      <span className="min-w-0 flex-1">
        {value.label} is signed out,{' '}
        {signOut === 'blocked'
          ? 'so it cannot take messages until it is signed in again.'
          : 'so messages will likely fail.'}{' '}
        {isTeamAdmin
          ? 'Sign it in again in Agent settings, or switch to another agent.'
          : `${ASK_ADMIN_TO_RECONNECT} Or switch to another agent.`}
      </span>
      {onSettings && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 px-2 text-[12px]"
          onClick={onSettings}
        >
          Agent settings
        </Button>
      )}
    </div>
  )
}
