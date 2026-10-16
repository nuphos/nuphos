import { useRef, useState } from 'react'

import type { DragEvent } from 'react'

const CHAT_DRAG_TYPE = 'application/x-nuphos-chat'

// The browser hides drag data until the drop, so targets that only take some
// chats look the dragged one up here while it hovers.
let draggedSessionId: string | null = null

/** Starts dragging a sidebar chat row; only sidebar drop targets read the payload. */
export function startChatDrag(event: DragEvent, sessionId: string): void {
  event.dataTransfer.setData(CHAT_DRAG_TYPE, sessionId)
  event.dataTransfer.effectAllowed = 'move'
  draggedSessionId = sessionId
}

export function endChatDrag(): void {
  draggedSessionId = null
}

/**
 * Makes an element accept a dragged chat. `over` is true while a chat hovers
 * it; enter/leave are counted so moving across child elements does not flicker.
 * With no handler the element ignores drags entirely, and `accepts` can turn
 * down a chat that is already where this target would put it.
 */
export function useChatDropTarget(
  onDrop: ((sessionId: string) => void) | undefined,
  accepts: (sessionId: string) => boolean = () => true,
) {
  const depth = useRef(0)
  const [over, setOver] = useState(false)

  if (!onDrop) return { over: false, props: {} }
  const carriesChat = (event: DragEvent) =>
    event.dataTransfer.types.includes(CHAT_DRAG_TYPE) &&
    draggedSessionId !== null &&
    accepts(draggedSessionId)

  return {
    over,
    props: {
      onDragEnter: (event: DragEvent) => {
        if (!carriesChat(event)) return
        event.preventDefault()
        event.stopPropagation()
        depth.current += 1
        setOver(true)
      },
      onDragOver: (event: DragEvent) => {
        if (!carriesChat(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
      },
      onDragLeave: (event: DragEvent) => {
        if (!carriesChat(event)) return
        event.stopPropagation()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: (event: DragEvent) => {
        const sessionId = event.dataTransfer.getData(CHAT_DRAG_TYPE)

        depth.current = 0
        setOver(false)
        endChatDrag()
        if (!sessionId) return
        event.preventDefault()
        event.stopPropagation()
        onDrop(sessionId)
      },
    },
  }
}
