import { useLayoutEffect, useRef, useState } from 'react'

import { pinBeforeAt, pinGridColumns } from './bot-pin-order'
import { usePinReflow } from './usePinReflow'

import type { Item } from './types'

export function usePinPreview(pins: Item[], place: (item: Item, before: Item | null) => void) {
  const [zone, setZone] = useState<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState(1)
  const [cellWidth, setCellWidth] = useState(68)

  usePinReflow(zone)
  const [preview, setPreview] = useState<{ key: string; before: string | null } | null>(null)
  const target = useRef<typeof preview>(null)

  useLayoutEffect(() => {
    const element = zone

    if (!element) return
    const measure = () => {
      const capacity = pinGridColumns(element.clientWidth)

      setColumns(capacity)
      setCellWidth(
        Math.min(96, Math.max(68, (element.clientWidth - 8 - (capacity - 1) * 4) / capacity)),
      )
    }
    const observer = new ResizeObserver(measure)

    observer.observe(element)
    measure()

    return () => observer.disconnect()
  }, [zone])
  const reset = () => {
    target.current = null
    setPreview(null)
  }
  const move = (key: string, x: number, y: number) => {
    const element = zone

    if (!element) return
    const bounds = element.getBoundingClientRect()

    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return
    const boxes = [...element.querySelectorAll<HTMLElement>('[data-pin-slot]')].map((slot) => {
      const rect = slot.getBoundingClientRect()

      return {
        key: slot.dataset.pinSlot ?? '',
        left: bounds.left + slot.offsetLeft,
        top: bounds.top + slot.offsetTop,
        width: rect.width,
        height: rect.height,
      }
    })
    const before = pinBeforeAt(boxes, key, x, y)

    if (before === undefined) return
    if (target.current?.key === key && target.current.before === before) return
    target.current = { key, before }
    setPreview({ key, before })
  }
  const commit = (item: Item) => {
    const before = target.current?.key === item.key ? target.current.before : undefined

    if (before === undefined && pins.some((pin) => pin.key === item.key)) return
    place(item, pins.find((pin) => pin.key === before) ?? null)
  }

  return { zone: setZone, columns, cellWidth, preview, move, commit, reset }
}
