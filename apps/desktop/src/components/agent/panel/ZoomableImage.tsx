import { Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { imageFitScale, imageZoomScale, zoomScrollOffset } from './imageZoom'

type Point = { x: number; y: number }

export function ZoomableImage({
  url,
  fileName,
  onDismiss,
}: {
  url: string
  fileName: string
  onDismiss: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const dragStart = useRef<Point | null>(null)
  const dragged = useRef(false)
  const anchor = useRef<{ point: Point; scale: number; left: number; top: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null)
  const fit = imageFitScale(size.width, size.height, view.width, view.height)
  const scale = zoom === null ? fit : imageZoomScale(zoom, fit)
  const enlarged = scale > fit + 0.00001

  useEffect(() => {
    const node = viewport.current

    if (!node) return
    const measure = () => setView({ width: node.clientWidth, height: node.clientHeight })
    const observer = new ResizeObserver(measure)

    observer.observe(node)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = viewport.current
    const previous = anchor.current

    if (!node) return
    if (!previous) {
      if (zoom === null) node.scrollTo(0, 0)

      return
    }
    node.scrollLeft = zoomScrollOffset(
      size.width * previous.scale,
      size.width * scale,
      node.clientWidth,
      previous.left,
      previous.point.x,
    )
    node.scrollTop = zoomScrollOffset(
      size.height * previous.scale,
      size.height * scale,
      node.clientHeight,
      previous.top,
      previous.point.y,
    )
    anchor.current = null
  }, [scale, size.width, size.height, zoom])

  const changeZoom = useCallback(
    (value: number | null, point?: Point) => {
      const node = viewport.current

      if (!node) return
      anchor.current =
        value === null
          ? null
          : {
              point: point ?? { x: node.clientWidth / 2, y: node.clientHeight / 2 },
              scale,
              left: node.scrollLeft,
              top: node.scrollTop,
            }
      setZoom(value === null ? null : imageZoomScale(value, fit))
    },
    [scale, fit],
  )

  useEffect(() => {
    const node = viewport.current

    if (!node) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const bounds = node.getBoundingClientRect()

      changeZoom(scale * Math.exp(-event.deltaY * 0.01), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
    }

    node.addEventListener('wheel', wheel, { passive: false })

    return () => node.removeEventListener('wheel', wheel)
  }, [changeZoom, scale])

  const release = (id: number) => {
    pointers.current.delete(id)
  }

  return (
    <div
      className="h-full w-full"
      onKeyDown={(event) => {
        if (event.key === '+' || event.key === '=') changeZoom(scale * 1.5)
        else if (event.key === '-') changeZoom(scale / 1.5)
        else if (event.key === '0') changeZoom(null)
        else if (event.key === '1') changeZoom(1)
        else if (enlarged && event.key.startsWith('Arrow')) {
          const direction: Record<string, Point> = {
            ArrowLeft: { x: -60, y: 0 },
            ArrowRight: { x: 60, y: 0 },
            ArrowUp: { x: 0, y: -60 },
            ArrowDown: { x: 0, y: 60 },
          }
          const delta = direction[event.key]

          viewport.current?.scrollBy(delta.x, delta.y)
        } else return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div
        className="absolute inset-x-12 top-2 flex items-center justify-center gap-1 [&_button]:text-white/80 [&_button]:hover:bg-white/10 [&_button]:hover:text-white"
        role="toolbar"
        aria-label={t('Image zoom')}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!enlarged}
          aria-label={t('Zoom out')}
          title={t('Zoom out (−)')}
          onClick={() => changeZoom(scale / 1.5)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <output
          className="w-11 text-center text-[12px] text-white/80 tabular-nums"
          aria-label={t('Zoom level')}
        >
          {Math.round(scale * 100)}%
        </output>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={scale >= 8}
          aria-label={t('Zoom in')}
          title={t('Zoom in (+)')}
          onClick={() => changeZoom(scale * 1.5)}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => changeZoom(1)}
          title={t('Actual size (1)')}
        >
          100%
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => changeZoom(null)}
          title={t('Fit image (0)')}
        >
          {t('Fit')}
        </Button>
      </div>
      <div
        ref={viewport}
        role="region"
        aria-label={t('Image viewport')}
        tabIndex={0}
        className="h-full w-full overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent"
        style={{ touchAction: 'none', cursor: enlarged ? 'grab' : 'zoom-in' }}
        onDoubleClick={() => changeZoom(enlarged ? null : 1)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          if (!pointers.current.size) {
            dragStart.current = { x: event.clientX, y: event.clientY }
            dragged.current = false
          }
          if (enlarged || event.pointerType === 'touch') {
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          }
          event.currentTarget.focus()
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId)

          if (!previous) return
          const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
          const next = { x: event.clientX, y: event.clientY }

          if (
            other ||
            (dragStart.current &&
              Math.hypot(next.x - dragStart.current.x, next.y - dragStart.current.y) > 5)
          ) {
            dragged.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }

          if (other) {
            const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y)
            const distance = Math.hypot(next.x - other.x, next.y - other.y)
            const bounds = event.currentTarget.getBoundingClientRect()

            if (oldDistance > 0)
              changeZoom((scale * distance) / oldDistance, {
                x: (next.x + other.x) / 2 - bounds.left,
                y: (next.y + other.y) / 2 - bounds.top,
              })
          } else if (enlarged) {
            event.currentTarget.scrollLeft -= next.x - previous.x
            event.currentTarget.scrollTop -= next.y - previous.y
          }
          pointers.current.set(event.pointerId, next)
        }}
        onPointerUp={(event) => release(event.pointerId)}
        onPointerCancel={(event) => release(event.pointerId)}
        onLostPointerCapture={(event) => release(event.pointerId)}
      >
        <div
          className="grid place-items-center"
          onClick={(event) => {
            if (!dragged.current && event.target === event.currentTarget) onDismiss()
          }}
          style={{
            width: Math.max(view.width, size.width * scale),
            height: Math.max(view.height, size.height * scale),
          }}
        >
          <img
            src={url}
            alt={fileName}
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            className="max-w-none rounded-lg shadow-2xl"
            style={{
              width: size.width * scale || undefined,
              height: size.height * scale || undefined,
              visibility: size.width ? 'visible' : 'hidden',
            }}
          />
        </div>
      </div>
    </div>
  )
}
