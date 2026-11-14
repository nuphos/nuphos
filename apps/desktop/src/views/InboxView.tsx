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
import { ShareApprovalRequests } from './inbox/ShareApprovalRequests'
import { useChannelMentions } from './inbox/useChannelMentions'
import { ANSWER_UNDO_MS, holdAnswer, sendHeldAnswer, useInboxQuestions } from './inbox/useInbox'
import { useShareApprovals } from './inbox/useShareApprovals'

import type { InboxQuestion } from './inbox/inboxItems'
import type { DecisionAnswer } from '../api/agent-chat-types'

type Props = {
  teamId: string
  query: string
  refreshKey: number
  onCount?: (n: number) => void
  onLoading?: (loading: boolean) => void
  onOpenConversation: (sessionId: string) => void
}

/**
 * Teammates asking to use the viewer's own computer and channel @mentions,
 * above one open question at a time, the one the sidebar's Inbox list opens.
 * Answering it opens the next, and wakes the agent that asked once its Undo
 * window passes, or at once when the viewer leaves; ↑ ↓ or Skip move between them. Its Bot or Task opens from the question's source line.
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
  const all = useInboxQuestions(teamId, refreshKey)
  const selected = useInboxSelection(teamId)
  const shareApprovals = useShareApprovals(teamId)
  const mentions = useChannelMentions(teamId) ?? []
  const needle = query.trim().toLowerCase()
  const rows = all?.filter(
    ({ conversation, request }) =>
      !needle ||
      [request.question, request.body, conversation.title].some((text) =>
        text?.toLowerCase().includes(needle),
      ),
  )
  const open = rows ? openQuestion(rows, selected) : undefined
  const at = open && rows ? rows.indexOf(open) : -1

  useEffect(() => onLoading?.(all === null), [all, onLoading])
  useEffect(() => onCount?.(all?.length ?? 0), [all?.length, onCount])

  const move = useCallback(
    (row: InboxQuestion | undefined) => {
      if (row && rows) selectInboxQuestion(teamId, { id: row.request.id, index: rows.indexOf(row) })
    },
    [teamId, rows],
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

  const answer = (row: InboxQuestion, reply: DecisionAnswer) => {
    // The answered question leaves the list, and the one that takes its place opens.
    const selection = { id: row.request.id, index: at }

    selectInboxQuestion(teamId, selection)
    const undo = holdAnswer(teamId, row.conversation.sessionId, row.request.id, reply)

    toast.success(
      t('Answered “{answer}”', {
        answer: reply.choices?.join(', ') ?? reply.text ?? row.request.question,
      }),
      undefined,
      {
        timeoutMs: ANSWER_UNDO_MS,
        dedupe: false,
        action: {
          label: t('Undo'),
          onClick: () => {
            undo()
            selectInboxQuestion(teamId, selection)
          },
        },
      },
    )
  }

  const caughtUp =
    all?.length === 0 && shareApprovals.approvals.length === 0 && mentions.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShareApprovalRequests teamId={teamId} {...shareApprovals} />
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
          onSkip={rows && rows.length > 1 ? () => move(rows.at(at + 1) ?? rows[0]) : undefined}
          onOpenConversation={() => onOpenConversation(open.conversation.sessionId)}
        />
      )}
    </div>
  )
}
