import type { MessageRating, Tab } from './model'

export type ConversationProps = {
  tab: Tab
  teamId?: string
  currentUrl?: string
  /** Match the docked composer's horizontal inset. */
  sidebar?: boolean
  /** False when a keep-alive panel is collapsed or its home page is shown. */
  visible?: boolean
  /** Fetch the previous page of a tail-loaded transcript (scroll-up paging). */
  onLoadEarlier?: () => void
  /** Persist a thumbs vote (rating null clears it); the optional comment
   *  comes from the thumbs-down dialog's second call. */
  onMessageFeedback?: (
    sessionId: string,
    messageId: string,
    rating: MessageRating | null,
    comment?: string,
  ) => void
  /** Viewer is a team administrator — gates approving permission-grant proposals. */
  isTeamAdmin?: boolean
  onDockToSidebar?: () => void
  onStop?: () => void
  /** Approve callback for an inline plan card. PATCHes the plan to `approved`
   *  and sends the synthetic resume message. */
  onApprovePlan?: (planId: string) => void
  onRejectPlan?: (planId: string, reason: string, mode: 'revise' | 'delete') => void
  /** Plan-level gating for the latest plan. Drives the Approve / Chat
   *  visibility on that plan's inline card instead of message-level recency. */
  activePlanCanAct?: {
    toolCallId: string
    canApprove: boolean
    canChat: boolean
    keepPolling: boolean
  } | null
  /** Opens Nuphos markdown links from assistant messages inside the desktop workspace. */
  onOpenNuphosLink?: (href: string) => boolean
  /** Opens Settings directly on the workspace Agent setup section. */
  onOpenAgentSettings?: () => void
}
