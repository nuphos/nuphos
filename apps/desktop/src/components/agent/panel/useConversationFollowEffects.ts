import { useEffect, useState } from 'react'

import { useWorkspaceTab } from '../../../hooks/useWorkspaceTab'

import type { Message, Tab } from './model'
import type { RefObject } from 'react'

export function useConversationFollowEffects({
  tab,
  lastMsg,
  lastStreamToken,
  localCommandToolToken,
  statusLabel,
  shouldFollowRef,
  unseenNewContentRef,
  userLockedScrollRef,
  setShowJumpToLatest,
  scrollToBottomAfterLayout,
  followLatestOrMarkUnseen,
}: {
  tab: Tab
  lastMsg: Message | undefined
  lastStreamToken: string
  statusLabel: string | null
  localCommandToolToken: string
  shouldFollowRef: RefObject<boolean>
  unseenNewContentRef: RefObject<boolean>
  userLockedScrollRef: RefObject<boolean>
  setShowJumpToLatest: (show: boolean) => void
  scrollToBottomAfterLayout: () => () => void
  followLatestOrMarkUnseen: () => (() => void) | undefined
}) {
  const [followedTabId, setFollowedTabId] = useState(tab.id)

  if (tab.id !== followedTabId) {
    setFollowedTabId(tab.id)
    setShowJumpToLatest(false)
  }

  useEffect(() => {
    shouldFollowRef.current = true
    userLockedScrollRef.current = false
    unseenNewContentRef.current = false

    return scrollToBottomAfterLayout()
  }, [scrollToBottomAfterLayout, shouldFollowRef, tab.id, unseenNewContentRef, userLockedScrollRef])

  // Keep-alive hides an inactive workspace tab with display:none, where the
  // transcript has no scroll box: whatever streams in meanwhile lands below
  // the fold, so a tab that was pinned to the bottom comes back mid-transcript.
  const { isActive } = useWorkspaceTab()

  useEffect(() => {
    if (!isActive || !shouldFollowRef.current || userLockedScrollRef.current) return

    return scrollToBottomAfterLayout()
  }, [isActive, scrollToBottomAfterLayout, shouldFollowRef, userLockedScrollRef])

  useEffect(() => {
    if (lastMsg?.role === 'user') {
      return scrollToBottomAfterLayout()
    }

    return followLatestOrMarkUnseen()
  }, [
    followLatestOrMarkUnseen,
    lastMsg?.role,
    lastStreamToken,
    scrollToBottomAfterLayout,
    tab.messages.length,
  ])

  // Timeline lines (invites, removals, a move in flight) are new content too.
  useEffect(
    () => followLatestOrMarkUnseen(),
    [followLatestOrMarkUnseen, tab.timelineEvents?.length, tab.movingTo],
  )

  // Runtime can show Working before any transcript part exists. Treat the
  // status row's layout change as new content, respecting a user's history lock.
  useEffect(() => followLatestOrMarkUnseen(), [followLatestOrMarkUnseen, statusLabel])

  useEffect(() => {
    if (!localCommandToolToken) return

    return followLatestOrMarkUnseen()
  }, [followLatestOrMarkUnseen, localCommandToolToken])
}
