import { useCallback, useLayoutEffect, useRef } from 'react'

import { AUTO_SCROLL_BOTTOM_THRESHOLD, EARLIER_MESSAGES_SCROLL_THRESHOLD } from './model'
import { useConversationFollowEffects } from './useConversationFollowEffects'

import type { Message, Tab } from './model'
import type { RefObject, TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from 'react'

export function useConversationScroll({
  tab,
  lastMsg,
  lastStreamToken,
  localCommandToolToken,
  statusLabel,
  onLoadEarlier,
  ref,
  shouldFollowRef,
  unseenNewContentRef,
  autoScrollUntilRef,
  userScrollIntentVersionRef,
  userLockedScrollRef,
  touchStartYRef,
  setShowJumpToLatest,
}: {
  tab: Tab
  lastMsg: Message | undefined
  lastStreamToken: string
  statusLabel: string | null
  localCommandToolToken: string
  onLoadEarlier?: () => void
  ref: RefObject<HTMLDivElement | null>
  shouldFollowRef: RefObject<boolean>
  unseenNewContentRef: RefObject<boolean>
  autoScrollUntilRef: RefObject<number>
  userScrollIntentVersionRef: RefObject<number>
  userLockedScrollRef: RefObject<boolean>
  touchStartYRef: RefObject<number | null>
  setShowJumpToLatest: (show: boolean) => void
}) {
  const isNearBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD
  }, [])
  const isAtBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 2
  }, [])
  const scrollToBottom = useCallback(() => {
    const el = ref.current

    if (!el) return
    autoScrollUntilRef.current = Date.now() + 250
    el.scrollTop = el.scrollHeight
    shouldFollowRef.current = true
    userLockedScrollRef.current = false
    unseenNewContentRef.current = false
    setShowJumpToLatest(false)
  }, [
    autoScrollUntilRef,
    ref,
    setShowJumpToLatest,
    shouldFollowRef,
    unseenNewContentRef,
    userLockedScrollRef,
  ])
  const scrollToBottomAfterLayout = useCallback(() => {
    const intentVersion = userScrollIntentVersionRef.current
    const scrollIfStillFollowing = () => {
      if (userScrollIntentVersionRef.current !== intentVersion) return
      scrollToBottom()
    }
    let frames = 0
    let frameId = 0
    const tick = () => {
      scrollIfStillFollowing()
      frames += 1
      if (frames < 4) frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    const timeoutId = window.setTimeout(scrollIfStillFollowing, 150)

    return () => {
      cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [scrollToBottom, userScrollIntentVersionRef])
  const handleUserScrollIntent = useCallback(() => {
    userScrollIntentVersionRef.current += 1
    autoScrollUntilRef.current = 0
  }, [autoScrollUntilRef, userScrollIntentVersionRef])
  const lockScrollToHistory = useCallback(() => {
    const el = ref.current

    handleUserScrollIntent()
    if (!el || el.scrollHeight <= el.clientHeight) return
    shouldFollowRef.current = false
    userLockedScrollRef.current = true
    setShowJumpToLatest(true)
  }, [handleUserScrollIntent, ref, setShowJumpToLatest, shouldFollowRef, userLockedScrollRef])
  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        lockScrollToHistory()

        return
      }
      handleUserScrollIntent()
    },
    [handleUserScrollIntent, lockScrollToHistory],
  )
  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null
      handleUserScrollIntent()
    },
    [handleUserScrollIntent, touchStartYRef],
  )
  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const startY = touchStartYRef.current
      const currentY = event.touches[0]?.clientY

      if (startY != null && currentY != null && currentY - startY > 4) {
        lockScrollToHistory()

        return
      }
      handleUserScrollIntent()
    },
    [handleUserScrollIntent, lockScrollToHistory, touchStartYRef],
  )
  const followLatestOrMarkUnseen = useCallback(() => {
    const el = ref.current

    if (!userLockedScrollRef.current && (shouldFollowRef.current || (el && isNearBottom(el)))) {
      return scrollToBottomAfterLayout()
    }
    unseenNewContentRef.current = true
    setShowJumpToLatest(true)
  }, [
    isNearBottom,
    ref,
    scrollToBottomAfterLayout,
    setShowJumpToLatest,
    shouldFollowRef,
    unseenNewContentRef,
    userLockedScrollRef,
  ])
  const hasEarlier = (tab.historyBaseIndex ?? 0) > 0
  // Viewport anchor for earlier-page prepends: the first rendered message and
  // its on-screen offset at request time. Re-anchoring to the element (rather
  // than scrollHeight math) stays correct with content-visibility placeholders,
  // whose heights only materialize lazily (DEFERRED_MESSAGE_STYLE).
  const earlierAnchorRef = useRef<{ id: string; top: number } | null>(null)
  const captureEarlierAnchor = useCallback(() => {
    const el = ref.current
    const firstMessage = el?.querySelector('[data-message-id]')
    const id = firstMessage?.getAttribute('data-message-id')

    earlierAnchorRef.current =
      firstMessage && id ? { id, top: firstMessage.getBoundingClientRect().top } : null
  }, [ref])

  useLayoutEffect(() => {
    const el = ref.current
    const anchor = earlierAnchorRef.current

    if (el && anchor) {
      const node = el.querySelector(`[data-message-id="${CSS.escape(anchor.id)}"]`)

      if (node) el.scrollTop += node.getBoundingClientRect().top - anchor.top
      earlierAnchorRef.current = null
    }
  }, [ref, tab.historyBaseIndex])

  const handleScroll = useCallback(() => {
    const el = ref.current

    if (!el) return
    // Scroll-up paging: only while the user is deliberately reading history
    // (userLockedScrollRef), so the mount-time jump-to-bottom pass can't fire
    // a page load from its transient scrollTop=0.
    if (
      onLoadEarlier &&
      hasEarlier &&
      !tab.loadingEarlier &&
      userLockedScrollRef.current &&
      el.scrollTop < EARLIER_MESSAGES_SCROLL_THRESHOLD
    ) {
      captureEarlierAnchor()
      onLoadEarlier()
    }
    const nearBottom = isNearBottom(el)
    const atBottom = isAtBottom(el)

    if (Date.now() < autoScrollUntilRef.current) {
      if (nearBottom) {
        shouldFollowRef.current = true
        userLockedScrollRef.current = false
        unseenNewContentRef.current = false
        setShowJumpToLatest(false)
      }

      return
    }
    if (atBottom) {
      shouldFollowRef.current = true
      userLockedScrollRef.current = false
      unseenNewContentRef.current = false
      setShowJumpToLatest(false)

      return
    }
    if (userLockedScrollRef.current) {
      shouldFollowRef.current = false
      setShowJumpToLatest(true)

      return
    }
    shouldFollowRef.current = nearBottom
    if (nearBottom) {
      unseenNewContentRef.current = false
      setShowJumpToLatest(false)
    } else {
      setShowJumpToLatest(unseenNewContentRef.current)
    }
  }, [
    autoScrollUntilRef,
    captureEarlierAnchor,
    hasEarlier,
    isAtBottom,
    isNearBottom,
    onLoadEarlier,
    ref,
    setShowJumpToLatest,
    shouldFollowRef,
    tab.loadingEarlier,
    unseenNewContentRef,
    userLockedScrollRef,
  ])

  useConversationFollowEffects({
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
  })

  return {
    hasEarlier,
    scrollToBottom,
    captureEarlierAnchor,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleUserScrollIntent,
  }
}
