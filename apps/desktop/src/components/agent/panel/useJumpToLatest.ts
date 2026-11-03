import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { unseenMessageCount } from './conversationFollow'

import type { Message } from './model'

/**
 * The jump-to-latest button's state. Hiding it means the reader is at the bottom,
 * so it also marks the last message read; while it shows, it counts what arrived
 * after that one.
 */
export function useJumpToLatest(messages: Message[], lastMsgId: string | undefined) {
  const [show, setShowState] = useState(false)
  const [readThroughId, setReadThroughId] = useState<string | null>(null)
  const lastMsgIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    lastMsgIdRef.current = lastMsgId ?? null
  }, [lastMsgId])
  const setShow = useCallback((next: boolean) => {
    setShowState(next)
    if (!next) setReadThroughId(lastMsgIdRef.current)
  }, [])

  return { show, setShow, unseen: show ? unseenMessageCount(messages, readThroughId) : 0 }
}
