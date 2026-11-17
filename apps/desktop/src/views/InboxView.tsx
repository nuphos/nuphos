import { Inbox } from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { EmptyState } from '../components/EmptyState'
import { toast } from '../components/ui/toast'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'

import { ChannelMentions } from './inbox/ChannelMentions'
import { DecisionCard } from './inbox/DecisionCard'
import { openQuestion } from './inbox/inboxItems'
import { selectInboxQuestion, useInboxSelection } from './inbox/inboxSelection'
import { useChannelMentions } from './inbox/useChannelMentions'
import { snoozeQuestion } from './inbox/dismissQuestion'
import { ANSWER_UNDO_MS, holdAnswer, sendHeldAnswer } from './inbox/useInbox'
import { useInboxQuestions } from './inbox/useInboxQuestions'

import type { InboxQuestion } from './inbox/inboxItems'
import type { HeldReply } from './inbox/useInbox'

type Props = {
  teamId: string
  query: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onOpenConversation: (sessionId: string) => void
  /** Opens a link in a question's text, as the conversation does. */
  onOpenLink: (href: string, beside: boolean) => boolean
}

/**
 * Teammates asking to use the viewer's own computer and channel @mentions,
 * above one open question at a time, the one the sidebar's Inbox list opens.
 * Answering it opens the next, and wakes the agent that asked once its Undo
 * window passes, or at once when the viewer leaves; a dismissal waits out the same window.
 * Snooze sets it aside until a time. ↑ ↓ move between them. Its Bot or Task opens from the question's source line.
 */
export function InboxView({
  teamId,
  query,
  refreshKey,
  onCount,
  onLoading,
  onOpenConversation,
  onOpenLink,
}: Props) {
  const { isActive } = useWorkspaceTab()
  const all = useInboxQuestions(teamId, refreshKey)
  const selected = useInboxSelection(teamId)
  // An invite is only announced, never listed.
  const mentions = useChannelMentions(teamId)?.filter((mention) => !mention.invited) ?? []
  const needle = query.trim().toLowerCase()
  const rows = all?.filter(
    ({ conversation, request }) =>
      !needle ||
      [request.question, request.body, conversation.title].some((text) =>
        text?.toLowerCase().includes(needle),
      ),
  )
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
    if (!isActive || !rows) return
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
  }, [isActive, rows, at, move])

  // Leaving the Inbox sends the answer still waiting out its Undo window.
  useEffect(() => {
    if (!isActive) return

    return sendHeldAnswer
  }, [isActive])

  const answer = (row: InboxQuestion, reply: HeldReply) => {
    // The answered question leaves the list, and the one that takes its place opens.
    const dismissed = 'dismissed' in reply

    move(rows?.at(at + 1) ?? rows?.at(at - 1))
    const undo = holdAnswer(teamId, row.conversation.sessionId, row.request.id, reply, (reason) =>
      toast.error(
        dismissed ? t('Could not dismiss question') : t('Could not send your answer'),
        reason,
      ),
    )

    toast.success(
      dismissed
        ? t('Dismissed')
        : t('Answered “{answer}”', {
            answer: reply.choices?.join(', ') ?? reply.text ?? row.request.question,
          }),
      undefined,
      {
        timeoutMs: ANSWER_UNDO_MS,
        dedupe: false,
        action: {
          label: t('Undo'),
          // Once sent, the answer stays: the question is not opened again.
          onClick: () => {
            if (undo()) selectInboxQuestion(teamId, row.request.id)
          },
        },
      },
    )
  }

  const caughtUp = all?.length === 0 && mentions.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChannelMentions mentions={mentions} onOpen={onOpenConversation} />
      {caughtUp && (
        <EmptyState
          icon={Inbox}
          title={t("You're all caught up")}
          description={t(
            'When an agent needs you to decide something, it shows up here. Answer it there and it leaves the Inbox.',
          )}
        />
      )}
      {open && (
        <DecisionCard
          key={open.request.id}
          teamId={teamId}
          conversation={open.conversation}
          request={open.request}
          keys={isActive}
          onAnswer={(reply) => answer(open, reply)}
          onSnooze={(until) => {
            // The snoozed question leaves the list, and its neighbour opens, as after an answer.
            move(rows?.at(at + 1) ?? rows?.at(at - 1))
            void snoozeQuestion(teamId, open.conversation.sessionId, open.request.id, until)
          }}
          onDismiss={(reason) => answer(open, { dismissed: true, reason: reason || undefined })}
          onOpenConversation={() => onOpenConversation(open.conversation.sessionId)}
          onOpenLink={onOpenLink}
        />
      )}
    </div>
  )
}
