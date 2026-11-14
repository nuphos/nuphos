import clsx from 'clsx'
import { PanelRightOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { t } from '../../../i18n'

import { ChatColumn } from './ChatColumn'
import { FeedbackCommentDialog } from './conversationBanners'
import { isOwnMessage } from './conversationFollow'
import { ConversationMessageList } from './conversationMessageList'
import {
  hasRunningToolFor,
  lastStreamTokenFor,
  localCommandToolTokenFor,
} from './conversationStreamTokens'
import { JumpToLatestButton } from './JumpToLatestButton'
import { computeStatus } from './status'
import { isShownMessage } from './turnBoundaries'
import { TurnRail } from './TurnRail'
import { useConversationRead } from './useConversationRead'
import { useConversationScroll } from './useConversationScroll'
import { useJumpToLatest } from './useJumpToLatest'
import { useTranscriptPageKeys } from './useTranscriptPageKeys'

import type { ConversationProps } from './conversationProps'

export function Conversation({
  tab,
  teamId,
  currentUrl,
  sidebar = false,
  visible = true,
  onDockToSidebar,
  onStop,
  onApprovePlan,
  onRejectPlan,
  activePlanCanAct,
  onOpenNuphosLink,
  onOpenAgentSettings,
  onEditMessage,
  isTeamAdmin = false,
  onLoadEarlier,
  onMessageFeedback,
}: ConversationProps) {
  const ref = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const unseenNewContentRef = useRef(false)
  const autoScrollUntilRef = useRef(0)
  const userScrollIntentVersionRef = useRef(0)
  const userLockedScrollRef = useRef(false)
  const touchStartYRef = useRef<number | null>(null)
  // Assistant message awaiting the optional thumbs-down comment. The vote is
  // already recorded when this opens; the dialog only adds detail.
  const [feedbackCommentFor, setFeedbackCommentFor] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lastMsg = tab.messages.findLast(isShownMessage)
  const currentUserId = useCurrentUser()?.id
  const lastMsgIsOwn = isOwnMessage(lastMsg, currentUserId, tab.foreign)
  const jump = useJumpToLatest(tab.messages, lastMsg?.id)
  const localCommandToolToken = useMemo(() => localCommandToolTokenFor(lastMsg), [lastMsg])
  const hasRunningTool = useMemo(() => hasRunningToolFor(lastMsg), [lastMsg])
  const lastStreamToken = useMemo(() => lastStreamTokenFor(lastMsg), [lastMsg])
  const status = computeStatus(tab, lastMsg)
  const statusLabel = status?.label ?? null
  // Presentation only: bridge the local send and the next runtime snapshot.
  const sendingFeedback =
    !statusLabel &&
    tab.streaming &&
    lastMsg?.role === 'user' &&
    !tab.readOnly &&
    !tab.foreign &&
    !tab.error &&
    !tab.agentSetupRequired
  const displayStatusLabel = statusLabel ?? (sendingFeedback ? t('Sending…') : null)
  const {
    hasEarlier,
    scrollToBottom,
    captureEarlierAnchor,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleUserScrollIntent,
    lockScrollToHistory,
  } = useConversationScroll({
    tab,
    lastMsg,
    lastMsgIsOwn,
    lastStreamToken,
    localCommandToolToken,
    statusLabel: displayStatusLabel,
    onLoadEarlier,
    ref,
    shouldFollowRef,
    unseenNewContentRef,
    autoScrollUntilRef,
    userScrollIntentVersionRef,
    userLockedScrollRef,
    touchStartYRef,
    setShowJumpToLatest: jump.setShow,
  })

  useConversationRead(tab.sessionId, visible)
  useTranscriptPageKeys(ref, lockScrollToHistory, handleUserScrollIntent)

  useEffect(() => {
    if (!hasRunningTool) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick)
    const interval = window.setInterval(tick, 1000)

    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
    }
  }, [hasRunningTool])

  // Reserve space above the messages for the floating page-mode controls.
  const hasHeaderOverlay = Boolean(onDockToSidebar)

  return (
    <div className="relative flex-1 min-h-0">
      {hasHeaderOverlay && (
        // Opaque raised island (composer recipe) — scrolling text disappears
        // behind it instead of colliding with ghost buttons.
        <div className="surface-raised absolute right-4 top-3 z-20 flex items-center gap-0.5 rounded-lg bg-agentCanvas p-0.5">
          {onDockToSidebar && (
            <button
              type="button"
              onClick={onDockToSidebar}
              className="h-7 w-7 rounded-md text-tertiary hover:text-main hover:bg-state-hover flex items-center justify-center transition-colors"
              title={t('Move to sidebar')}
              aria-label={t('Move to sidebar')}
            >
              <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
        </div>
      )}
      <div
        ref={ref}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={handleUserScrollIntent}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className={clsx(
          'h-full overflow-auto scrollbar-thin pb-4 selectable',
          hasHeaderOverlay ? 'pt-16' : 'pt-4',
        )}
      >
        <ChatColumn sidebar={sidebar}>
          <ConversationMessageList
            tab={tab}
            teamId={teamId}
            currentUrl={currentUrl}
            lastMsg={lastMsg}
            now={now}
            statusLabel={displayStatusLabel}
            sendingFeedback={sendingFeedback}
            hasEarlier={hasEarlier}
            captureEarlierAnchor={captureEarlierAnchor}
            onLoadEarlier={onLoadEarlier}
            onStop={onStop}
            onApprovePlan={onApprovePlan}
            onRejectPlan={onRejectPlan}
            activePlanCanAct={activePlanCanAct}
            onOpenNuphosLink={onOpenNuphosLink}
            onOpenAgentSettings={onOpenAgentSettings}
            onEditMessage={onEditMessage}
            isTeamAdmin={isTeamAdmin}
            onMessageFeedback={onMessageFeedback}
            onRequestFeedbackComment={setFeedbackCommentFor}
          />
        </ChatColumn>
      </div>
      <TurnRail messages={tab.messages} scrollRef={ref} onBeforeJump={lockScrollToHistory} />
      {jump.show && <JumpToLatestButton unseen={jump.unseen} onClick={scrollToBottom} />}
      {feedbackCommentFor && (
        <FeedbackCommentDialog
          onClose={() => setFeedbackCommentFor(null)}
          onSubmit={(comment) => {
            onMessageFeedback?.(tab.sessionId, feedbackCommentFor, 'down', comment)
            setFeedbackCommentFor(null)
          }}
        />
      )}
    </div>
  )
}
