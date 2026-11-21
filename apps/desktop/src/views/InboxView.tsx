import { Inbox } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { EmptyState } from '../components/EmptyState'
import { toast } from '../components/ui/toast'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'

import { ChannelMentions } from './inbox/ChannelMentions'
import { DecisionCard } from './inbox/DecisionCard'
import { dismissQuestions } from './inbox/dismissAll'
import { DismissAllButton } from './inbox/DismissAllButton'
import { openQuestion, shownQuestions } from './inbox/inboxItems'
import { selectInboxQuestion, useInboxSelection } from './inbox/inboxSelection'
import { openListed } from './inbox/openListed'
import { useChannelMentions } from './inbox/useChannelMentions'
import { snoozeQuestion } from './inbox/dismissQuestion'
import { replyInInbox } from './inbox/useInbox'
import { useInboxQuestions } from './inbox/useInboxQuestions'

import type { InboxQuestion } from './inbox/inboxItems'
import type { InboxReply } from './inbox/useInbox'

type Props = {
  teamId: string
  query: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onOpenConversation: (sessionId: string) => void
}

/** Dismisses `questions` at once, as a single Dismiss is. Those refused come back in the list, and a toast counts them. */
function dismissAll(teamId: string, questions: readonly InboxQuestion[]) {
  dismissQuestions(teamId, questions, ({ failed, reason }) => {
    if (failed.length === 1) toast.error(t('Could not dismiss question'), reason)
    else if (failed.length > 1)
      toast.error(t('Could not dismiss {n} questions', { n: failed.length }))
  })
}

/**
 * Teammates asking to use the viewer's own computer and channel @mentions,
 * above one open question at a time, the one the sidebar's Inbox list opens.
 * Answering or dismissing it opens the next and wakes the agent that asked at once.
 * Snooze sets it aside until a time, and "Dismiss all" dismisses every question shown.
 * ↑ ↓ move between them. Who asked opens from the question's source line, where the sidebar lists it.
 */
export function InboxView({
  teamId,
  query,
  refreshKey,
  onCount,
  onLoading,
  onOpenConversation,
}: Props) {
  const { isActive } = useWorkspaceTab()
  const [confirming, setConfirming] = useState(false)
  // Keys rest while "Dismiss all" asks first.
  const keys = isActive && !confirming
  const all = useInboxQuestions(teamId, refreshKey)
  const selected = useInboxSelection(teamId)
  // An invite is only announced, never listed.
  const mentions = useChannelMentions(teamId)?.filter((mention) => !mention.invited) ?? []
  const rows = all ? shownQuestions(all, query) : undefined
  const open = rows ? openQuestion(rows, selected) : undefined
  const openId = open?.request.id
  const at = open && rows ? rows.indexOf(open) : -1

  // What opens stays open: a question listed later never takes its place.
  useEffect(() => {
    if (openId) selectInboxQuestion(teamId, openId)
  }, [teamId, openId])
  useEffect(() => onLoading?.(all === null), [all, onLoading])
  useEffect(() => onCount?.(all?.length ?? 0), [all?.length, onCount])

  const move = useCallback(
    (row: InboxQuestion | undefined) => {
      if (row) selectInboxQuestion(teamId, row.request.id)
    },
    [teamId],
  )

  // ↑ and ↓ open the question above or below, unless a field has the caret.
  useEffect(() => {
    if (!keys || !rows) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ''))
        return
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      const index = at + (event.key === 'ArrowDown' ? 1 : -1)
      const next = index >= 0 ? rows.at(index) : undefined

      if (!next) return
      event.preventDefault()
      move(next)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keys, rows, at, move])

  const answer = (row: InboxQuestion, reply: InboxReply) => {
    // The answered question leaves the list, and the one that takes its place opens.
    const dismissed = 'dismissed' in reply

    move(rows?.at(at + 1) ?? rows?.at(at - 1))
    replyInInbox(teamId, row.conversation.sessionId, row.request.id, reply, (reason) =>
      toast.error(
        dismissed ? t('Could not dismiss question') : t('Could not send your answer'),
        reason,
      ),
    )
  }

  const caughtUp = all?.length === 0 && mentions.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DismissAllButton
        questions={rows}
        active={isActive}
        confirming={confirming}
        onConfirming={setConfirming}
        onConfirm={(questions) => dismissAll(teamId, questions)}
      />
      <ChannelMentions
        mentions={mentions}
        onOpen={(sessionId) =>
          openListed(teamId, { sessionId, kind: 'channel' }, onOpenConversation)
        }
      />
      {caughtUp && (
        <EmptyState
          icon={Inbox}
          title={t("You're all caught up")}
          description={t(
            'When a Bot or task needs you to decide something, it shows up here. Answer it there and it leaves the Inbox.',
          )}
        />
      )}
      {open && (
        <DecisionCard
          key={open.request.id}
          teamId={teamId}
          conversation={open.conversation}
          bot={open.bot}
          request={open.request}
          keys={keys}
          onAnswer={(reply) => answer(open, reply)}
          onSnooze={(until) => {
            // The snoozed question leaves the list, and its neighbour opens, as after an answer.
            move(rows?.at(at + 1) ?? rows?.at(at - 1))
            void snoozeQuestion(teamId, open.conversation.sessionId, open.request.id, until)
          }}
          onDismiss={(reason) => answer(open, { dismissed: true, reason: reason || undefined })}
          onOpenSource={(source) => openListed(teamId, source, onOpenConversation)}
        />
      )}
    </div>
  )
}
