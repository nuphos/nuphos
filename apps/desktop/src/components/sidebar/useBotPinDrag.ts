import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { BOT_PIN_DRAG_TYPE } from './bot-pin-drag.ts'

import type { Item } from './types'
import type { DragEvent as ReactDragEvent, PointerEvent } from 'react'

/** Pointer preview starts at 3px, before the OS starts its native drag session. */
export function useBotPinDrag(
  bots: Item[],
  pinned: (item: Item) => boolean,
  toggle: (item: Item) => void,
  onExternalDrop?: (item: Item, target: Element, x: number, y: number) => void,
  preview?: {
    onMove: (key: string, x: number, y: number) => void
    onPinDrop: (item: Item) => void
    onEnd: () => void
  },
) {
  const [dragged, setDragged] = useState<string | null>(null)
  const pointer = useRef<{
    key: string
    x: number
    y: number
    grabX: number
    grabY: number
    moved: boolean
    source: HTMLElement
    row: HTMLElement
    id: number
  } | null>(null)
  const suppressClick = useRef(false)
  const native = useRef(false)
  const ghost = useRef<HTMLDivElement>(null)
  const point = useRef({ x: 0, y: 0 })
  const latest = useRef({ bots, pinned, toggle, onExternalDrop, preview })

  useLayoutEffect(() => {
    latest.current = { bots, pinned, toggle, onExternalDrop, preview }
  }, [bots, pinned, toggle, onExternalDrop, preview])

  useLayoutEffect(() => {
    positionGhost(ghost.current, pointer.current, point.current)
  }, [dragged])

  useEffect(() => {
    const end = () => {
      pointer.current?.row.style.removeProperty('opacity')
      pointer.current = null
      setDragged(null)
      latest.current.preview?.onEnd()
    }
    const start = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes(BOT_PIN_DRAG_TYPE)) return
      native.current = true
      const key = event.dataTransfer.getData(BOT_PIN_DRAG_TYPE)

      flushSync(() => setDragged(key))
    }
    const move = (event: globalThis.PointerEvent) => {
      const current = pointer.current

      if (!current) return
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3) return
      if (!current.moved) {
        try {
          current.source.setPointerCapture?.(current.id)
        } catch {
          /* Native cancellation may already have released this pointer. */
        }
      }
      current.row.style.opacity = '0.4'
      current.moved = true
      event.preventDefault()
      point.current = { x: event.clientX, y: event.clientY }
      positionGhost(ghost.current, current, point.current)
      suppressClick.current = true
      flushSync(() => setDragged(current.key))
      latest.current.preview?.onMove(current.key, event.clientX, event.clientY)
    }
    const up = (event: globalThis.PointerEvent) => {
      const current = pointer.current
      const { bots: items, pinned: isPinned, toggle: togglePin } = latest.current
      const bot = items.find((item) => item.key === current?.key)
      const target = document.elementFromPoint(event.clientX, event.clientY)

      if (current?.moved && bot && !native.current) {
        const zone = current.source.querySelector('[data-bot-pin-zone]')
        const bounds = zone?.getBoundingClientRect()
        // The visible shelf is still growing: accept its final content bounds
        // so a quick release need not wait for the expansion animation.
        const inShelf = Boolean(
          bounds &&
          bounds.width > 0 &&
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom,
        )
        const pinDrop = inShelf || Boolean(target?.closest('[data-bot-pin-zone]'))
        const listDrop = Boolean(target?.closest('[data-bot-pin-list]'))

        if (pinDrop && latest.current.preview) latest.current.preview.onPinDrop(bot)
        else if ((pinDrop && !isPinned(bot)) || (listDrop && isPinned(bot))) togglePin(bot)
        else if (!pinDrop && !listDrop && target)
          latest.current.onExternalDrop?.(bot, target, event.clientX, event.clientY)
      }
      end()
      native.current = false
    }
    const cancel = () => {
      if (!native.current) end()
      else pointer.current = null
    }
    const drop = () => {
      native.current = false
      end()
    }

    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', drop)
    window.addEventListener('drop', drop)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', drop)

    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', drop)
      window.removeEventListener('drop', drop)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', drop)
    }
  }, [])

  return {
    dragged,
    setDragged,
    ghost,
    onDragStartCapture: (event: ReactDragEvent) => {
      if (!pointer.current) return
      // Own this pointer gesture; native drag cancels pointer events on macOS.
      event.preventDefault()
      event.stopPropagation()
    },
    onPointerDownCapture: (event: PointerEvent) => {
      suppressClick.current = false
      native.current = false
      if (event.button !== 0) return
      const key = (event.target as HTMLElement).closest<HTMLElement>('[data-bot-pin-key]')?.dataset
        .botPinKey

      if (key) {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-bot-pin-key]')!
        const bounds = row.getBoundingClientRect()

        pointer.current = {
          key,
          x: event.clientX,
          y: event.clientY,
          grabX: bounds.width ? (event.clientX - bounds.left) / bounds.width : 0.5,
          grabY: bounds.height ? (event.clientY - bounds.top) / bounds.height : 0.5,
          moved: false,
          source: event.currentTarget as HTMLElement,
          row,
          id: event.pointerId,
        }
      }
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (!suppressClick.current) return
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
    },
  }
}

/** Preserve the point grabbed even when a list row becomes a compact preview. */
function positionGhost(
  ghost: HTMLDivElement | null,
  grab: { grabX: number; grabY: number } | null,
  point: { x: number; y: number },
) {
  if (!ghost || !grab) return
  const bounds = ghost.getBoundingClientRect()
  const x = point.x - grab.grabX * bounds.width
  const y = point.y - grab.grabY * bounds.height

  ghost.style.transform = `translate3d(${String(x)}px,${String(y)}px,0)`
}
