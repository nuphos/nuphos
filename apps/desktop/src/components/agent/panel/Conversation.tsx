import clsx from 'clsx'
import { ArrowDownToLine, PanelRightOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { FeedbackCommentDialog } from './conversationBanners'
import { ConversationMessageList } from './conversationMessageList'
import {
  hasRunningToolFor,
  lastStreamTokenFor,
  localCommandToolTokenFor,
} from './conversationStreamTokens'
import { statusElapsedSeconds } from './sessionContinuity'
import { computeStatus } from './status'
import { useConversationRead } from './useConversationRead'
import { useConversationScroll } from './useConversationScroll'

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
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  // Assistant message awaiting the optional thumbs-down comment. The vote is
  // already recorded when this opens; the dialog only adds detail.
  const [feedbackCommentFor, setFeedbackCommentFor] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [statusClock, setStatusClock] = useState<{
    status: string | null
    startedAt: number | null
  }>({ status: null, startedAt: null })
  const lastMsg = tab.messages[tab.messages.length - 1]
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
  const displayStatusLabel = statusLabel ?? (sendingFeedback ? 'Sending…' : null)
  const {
    hasEarlier,
    scrollToBottom,
    captureEarlierAnchor,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleUserScrollIntent,
  } = useConversationScroll({
    tab,
    lastMsg,
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
    setShowJumpToLatest,
  })

  useConversationRead(tab.sessionId, visible)

  const statusStartedAt = status?.startedAt ?? null
  const statusElapsed =
    tab.runtimeState?.schemaVersion === 2
      ? null
      : statusElapsedSeconds(statusStartedAt, statusLabel, statusClock, now)

  // Wall-clock reads only happen outside render, so both the status anchor and
  // the first tick land on the next turn of the event loop.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStatusClock((prev) => {
        if (prev.status === statusLabel) return prev

        return { status: statusLabel, startedAt: statusLabel ? Date.now() : null }
      })
    })

    return () => window.clearTimeout(timer)
  }, [statusLabel])

  useEffect(() => {
    if (!statusLabel && !hasRunningTool) return
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick)
    const interval = window.setInterval(tick, 1000)

    return () => {
      window.clearTimeout(first)
      window.clearInterval(interval)
    }
  }, [hasRunningTool, statusLabel])

  // Page mode floats corner buttons over the transcript (this cluster plus
  // App's "All chats" pill); reserve space above the messages for them.
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
              className="h-7 w-7 rounded-md text-tertiary hover:text-main hover:bg-zGray-800/70 flex items-center justify-center transition-colors"
              title="Move to sidebar"
              aria-label="Move conversation to sidebar"
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
          sidebar ? 'px-2.5' : 'px-3',
          hasHeaderOverlay ? 'pt-16' : 'pt-4',
        )}
      >
        <ConversationMessageList
          tab={tab}
          teamId={teamId}
          currentUrl={currentUrl}
          lastMsg={lastMsg}
          now={now}
          statusLabel={displayStatusLabel}
          sendingFeedback={sendingFeedback}
          statusElapsed={statusElapsed}
          hasEarlier={hasEarlier}
          captureEarlierAnchor={captureEarlierAnchor}
          onLoadEarlier={onLoadEarlier}
          onStop={onStop}
          onApprovePlan={onApprovePlan}
          onRejectPlan={onRejectPlan}
          activePlanCanAct={activePlanCanAct}
          onOpenNuphosLink={onOpenNuphosLink}
          onOpenAgentSettings={onOpenAgentSettings}
          isTeamAdmin={isTeamAdmin}
          onMessageFeedback={onMessageFeedback}
          onRequestFeedbackComment={setFeedbackCommentFor}
        />
      </div>
      {showJumpToLatest && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-zGray-700/80 bg-elevated/90 text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[transform,color,border-color,background-color] hover:-translate-x-1/2 hover:-translate-y-0.5 hover:border-zViolet-accent/60 hover:bg-zGray-800 hover:text-main"
          title="Jump to latest"
          aria-label="Jump to latest"
        >
          <ArrowDownToLine className="h-4 w-4" strokeWidth={1.8} />
        </button>
      )}
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
