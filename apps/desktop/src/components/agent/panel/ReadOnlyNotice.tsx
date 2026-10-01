import { faSlack } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { conversationReadOnlyLabel } from '../../../lib/conversationActivityBadges'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { ConversationActivityBadges } from './historyRows'
import { slackThreadFallbackUrl } from './slackThreadUrl'

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
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[#b36ab9]/35 bg-[#611f69]/15 px-2.5 text-[11px] font-medium text-[#d79add] transition-colors hover:bg-[#611f69]/25 disabled:cursor-wait disabled:opacity-60"
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
