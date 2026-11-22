import type { Message, MessageRating, Tab } from './model'

export type ConversationProps = {
  tab: Tab
  teamId?: string
  currentUrl?: string
  /** Match the docked composer's horizontal inset. */
  sidebar?: boolean
  /** The composer below: the transcript's end keeps room for the bars floating above it. */
  composer?: HTMLElement | null
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
  /** The latest plan's card keeps polling while its tab streams. */
  activePlanCanAct?: {
    toolCallId: string
    keepPolling: boolean
  } | null
  /** Opens Nuphos markdown links from assistant messages inside the desktop workspace. */
  onOpenNuphosLink?: (href: string, beside?: boolean) => boolean
  /** Re-runs one of your sent messages with new text, in a fork of the chat. */
  onEditMessage?: {
    allowed: (message: Message) => boolean
    edit: (messageId: string, text: string) => void
  }
  /** Opens Settings directly on the workspace Agent setup section. */
  onOpenAgentSettings?: () => void
}
