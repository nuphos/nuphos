import clsx from 'clsx'
import { Inbox } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EmptyState } from '../components/EmptyState'
import { useElementSize } from '../grafana/useElementSize'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { t } from '../i18n'

import { ChannelMentions } from './inbox/ChannelMentions'
import { DecisionCard } from './inbox/DecisionCard'
import { inboxQuestions, openQuestion } from './inbox/inboxItems'
import { QuestionRail } from './inbox/QuestionRail'
import { ShareApprovalRequests } from './inbox/ShareApprovalRequests'
import { useChannelMentions } from './inbox/useChannelMentions'
import { answerDecision, useAnsweredOnDevice, useInboxListing } from './inbox/useInbox'
import { useShareApprovals } from './inbox/useShareApprovals'

import type { InboxQuestion } from './inbox/inboxItems'

// Below this the page shows the list alone, and a row opens its conversation.
const TWO_PANE_MIN_WIDTH = 720
const RAIL_WIDTH = 340

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
 * above every open question waiting on the viewer, one row each, the same rows
 * the sidebar badge counts. The reader shows the selected question as a card:
 * a choice, or an answer typed on the card, answers it. Its conversation opens
 * in its own tab; only an answer or dismissal clears a question.
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
  const { ref, width } = useElementSize<HTMLDivElement>()
  const twoPane = width === 0 || width >= TWO_PANE_MIN_WIDTH
  const listing = useInboxListing(teamId, refreshKey).data ?? null
  const [selected, setSelected] = useState<{ id: string; index: number } | null>(null)
  // Another team's selection is no answer for this one.
  const [shownTeamId, setShownTeamId] = useState(teamId)

  if (shownTeamId !== teamId) {
    setShownTeamId(teamId)
    setSelected(null)
  }
  const shareApprovals = useShareApprovals(teamId)
  const mentions = useChannelMentions(teamId) ?? []
  const railRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  // A question answered here leaves the Inbox and the badge at once, before the listing does.
  const answered = useAnsweredOnDevice()
  const all = listing ? inboxQuestions(listing, answered) : null
  const needle = query.trim().toLowerCase()
  const rows = all?.filter(
    ({ conversation, request }) =>
      !needle ||
      [request.question, request.body, conversation.title].some((text) =>
        text?.toLowerCase().includes(needle),
      ),
  )
  const open = rows ? openQuestion(rows, selected) : undefined

  useEffect(() => onLoading?.(listing === null), [listing, onLoading])
  useEffect(() => onCount?.(all?.length ?? 0), [all?.length, onCount])

  const select = useCallback((row: InboxQuestion | undefined, list: readonly InboxQuestion[]) => {
    setSelected(row ? { id: row.request.id, index: list.indexOf(row) } : null)
  }, [])

  // Enter or → moves from the list into the card's answer field; Esc comes back.
  useEffect(() => {
    if (!isActive || !twoPane) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      const typing =
        Boolean(target?.isContentEditable) ||
        Boolean(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const inRail = !target || target === document.body || railRef.current?.contains(target)

      if (event.key === 'Escape' && typing && readerRef.current?.contains(target)) {
        event.preventDefault()
        railRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus()

        return
      }
      if ((event.key === 'Enter' || event.key === 'ArrowRight') && !typing && inRail) {
        const field = readerRef.current?.querySelector<HTMLElement>('input[type="text"]')

        if (field) {
          event.preventDefault()
          field.focus()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isActive, twoPane])

  const empty = all !== null && all.length === 0
  const caughtUp = empty && shareApprovals.approvals.length === 0 && mentions.length === 0
  const sessionId = open?.conversation.sessionId

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ShareApprovalRequests teamId={teamId} {...shareApprovals} />
      <ChannelMentions mentions={mentions} onOpen={onOpenConversation} />
      <div ref={ref} className="flex min-h-0 flex-1">
        {caughtUp && (
          <EmptyState
            icon={Inbox}
            title={t("You're all caught up")}
            description={t(
              'When an agent needs you to decide something, it shows up here. Answer it there and it leaves the Inbox.',
            )}
          />
        )}
        {rows && !empty && (
          <div
            ref={railRef}
            className={clsx(
              'flex h-full min-h-0 flex-col',
              twoPane ? 'flex-shrink-0' : 'min-w-0 flex-1',
            )}
            style={twoPane ? { width: RAIL_WIDTH } : undefined}
          >
            <QuestionRail
              rows={rows}
              openId={twoPane ? open?.request.id : undefined}
              keyboardNavigation={isActive && twoPane}
              onSelect={(row) =>
                twoPane ? select(row, rows) : onOpenConversation(row.conversation.sessionId)
              }
            />
          </div>
        )}
        {twoPane && open && sessionId && (
          <div ref={readerRef} className="flex min-w-0 flex-1 flex-col">
            <DecisionCard
              key={open.request.id}
              teamId={teamId}
              sessionId={sessionId}
              title={open.conversation.title}
              request={open.request}
              canManage={Boolean(open.conversation.canManage) && !open.conversation.readOnly}
              // The answer wakes the agent that asked, which replies where it asked.
              onAnswer={(answer) => void answerDecision(teamId, sessionId, open.request.id, answer)}
              onOpenConversation={() => onOpenConversation(sessionId)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
