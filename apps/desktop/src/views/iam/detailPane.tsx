import clsx from 'clsx'
import { Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useDetailSidebarTransition } from '../../hooks/useDetailSidebarTransition'
import { useResetOnKey } from '../useResetOnKey'

const DETAIL_PANE_WIDTH_KEY = 'nuphos.iam-detail-pane-width'
const DETAIL_PANE_DEFAULT_WIDTH = 560
const DETAIL_PANE_MIN_WIDTH = 420
const DETAIL_PANE_MAX_WIDTH = 900
const DETAIL_PANE_MAIN_MIN_WIDTH = 360

function clampDetailPaneWidth(width: number, hostWidth?: number): number {
  const viewportMax =
    typeof hostWidth === 'number' && hostWidth > 0
      ? Math.max(
          DETAIL_PANE_MIN_WIDTH,
          Math.min(DETAIL_PANE_MAX_WIDTH, hostWidth - DETAIL_PANE_MAIN_MIN_WIDTH),
        )
      : typeof window === 'undefined'
        ? DETAIL_PANE_MAX_WIDTH
        : Math.max(
            DETAIL_PANE_MIN_WIDTH,
            Math.min(DETAIL_PANE_MAX_WIDTH, window.innerWidth - DETAIL_PANE_MAIN_MIN_WIDTH),
          )

  return Math.min(viewportMax, Math.max(DETAIL_PANE_MIN_WIDTH, width))
}

function useDetailPaneWidth(
  paneRef: React.RefObject<HTMLElement | null>,
): [number, (next: number) => void] {
  const hostWidth = useCallback(() => paneRef.current?.parentElement?.clientWidth, [paneRef])
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(DETAIL_PANE_WIDTH_KEY))

      return clampDetailPaneWidth(
        Number.isFinite(stored) && stored > 0 ? stored : DETAIL_PANE_DEFAULT_WIDTH,
      )
    } catch {
      return DETAIL_PANE_DEFAULT_WIDTH
    }
  })

  const updateWidth = useCallback(
    (next: number) => {
      setWidth(clampDetailPaneWidth(next, hostWidth()))
    },
    [hostWidth],
  )

  useEffect(() => {
    const host = paneRef.current?.parentElement

    if (!host) return
    const observer = new ResizeObserver(() => {
      setWidth((prev) => clampDetailPaneWidth(prev, host.clientWidth))
    })

    observer.observe(host)

    return () => observer.disconnect()
  }, [paneRef])

  useEffect(() => {
    try {
      localStorage.setItem(DETAIL_PANE_WIDTH_KEY, String(width))
    } catch {
      // localStorage can be unavailable in restricted environments.
    }
  }, [width])

  return [width, updateWidth]
}

export function ResizableDetailPane({
  children,
  onClose,
}: {
  children: (requestClose: () => void) => React.ReactNode
  onClose: () => void
}) {
  const paneRef = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useDetailPaneWidth(paneRef)
  const [dragging, setDragging] = useState(false)
  const { contentOpen, open, requestClose } = useDetailSidebarTransition(onClose, paneRef)

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width

    setDragging(true)

    const move = (event: PointerEvent) => {
      setWidth(startWidth + startX - event.clientX)
    }
    const stop = () => {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  return (
    <aside
      ref={paneRef}
      data-open={open ? 'true' : 'false'}
      style={{ width: open ? width : 0, minWidth: open ? undefined : 0 }}
      className={clsx(
        't-detail-sidebar-frame relative flex-shrink-0 border-l border-zGray-800 bg-zGray-950/60 flex flex-col min-h-0',
        dragging && 'select-none',
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize detail sidebar"
        title="Resize detail sidebar"
        onPointerDown={startResize}
        className="group absolute left-0 top-0 bottom-0 z-20 w-3 -translate-x-1/2 cursor-col-resize touch-none"
      >
        <div className="mx-auto h-full w-px bg-transparent group-hover:bg-zViolet-accent/60" />
      </div>
      <div
        className="t-panel-slide t-detail-sidebar-content flex min-h-0 flex-col"
        data-open={contentOpen ? 'true' : 'false'}
      >
        {children(requestClose)}
      </div>
    </aside>
  )
}

export function DetailSidebarCloseButton({ onClose }: { onClose?: () => void }) {
  if (!onClose) return null

  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-3 top-3 z-30 w-7 h-7 rounded-md text-tertiary hover:text-main hover:bg-zGray-800 flex items-center justify-center"
      title="Close"
    >
      <X className="w-3.5 h-3.5" strokeWidth={1.8} />
    </button>
  )
}

export function DetailSidebarLoading() {
  return (
    <div className="flex min-h-[220px] flex-1 items-center justify-center">
      <Loader2 className="w-4 h-4 animate-spin text-zViolet-accent" strokeWidth={1.8} />
    </div>
  )
}

export function LoadedDetailContentReveal({
  children,
  revealKey,
}: {
  children: React.ReactNode
  revealKey: string
}) {
  const [open, setOpen] = useState(false)

  useResetOnKey(revealKey, () => setOpen(false))

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))

    return () => cancelAnimationFrame(frame)
  }, [revealKey])

  return (
    <div className="t-panel-slide t-detail-loaded-content" data-open={open ? 'true' : 'false'}>
      {children}
    </div>
  )
}
