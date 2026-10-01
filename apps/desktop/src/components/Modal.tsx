import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import type { ReactNode } from 'react'

// Duration of the open/close transition (ms). Kept in one place so the JS
// unmount timer and the CSS `duration-*` classes stay in lockstep. NOTE:
// Tailwind's JIT can't read a JS constant, so the `duration-150` class strings
// below are hardcoded — if you change ANIM_MS, update those to match (search
// `duration-` in this file).
const ANIM_MS = 150

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  /** Optional pinned footer. Rendered outside the scrollable body so it stays
   *  fixed at the bottom while a tall body scrolls. */
  footer?: ReactNode
  width?: number
  /** Lightweight single-field dialogs, without section dividers. */
  appearance?: 'default' | 'prompt'
  surface?: 'dark' | 'light'
  /**
   * Hold the panel at its maximum height instead of sizing it to the content.
   * For a body whose content changes as the user works in it — a filterable
   * catalog — where a content-driven height means the panel resizes under the
   * cursor on every keystroke.
   */
  fillHeight?: boolean
  /** Single-row header with tighter padding and a muted title — the
   *  Linear-changelog-style chrome the What's New reader uses. */
  headerCompact?: boolean
  /** Whether the header draws its bottom divider (default true). Turn off when
   *  the body opens with its own surface and the line would double up. */
  headerDivider?: boolean
  /** Optional icon buttons rendered in the top-right corner, just left of
   *  the close button (e.g. an open-in-browser action). */
  headerActions?: ReactNode
  /**
   * Whether clicking the backdrop scrim closes the modal (default true). Turn
   * off for multi-step flows where a stray click outside would silently throw
   * away the user's progress — closing then requires an explicit action
   * (Escape, the X button, or a Cancel/Done button).
   */
  closeOnBackdrop?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
  appearance = 'default',
  surface = 'dark',
  fillHeight = false,
  headerCompact = false,
  headerDivider = true,
  headerActions,
  closeOnBackdrop = true,
}: Props) {
  const isLight = surface === 'light'
  const isPrompt = appearance === 'prompt'

  // Two-phase visibility so the panel can animate on both open AND close:
  //  - `mounted` keeps the portal in the DOM through the exit transition.
  //  - `shown` drives the enter/leave CSS state (flipped a frame after mount
  //    so the browser has an initial "hidden" style to transition from).
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  // Opening mounts immediately; closing keeps the portal alive for ANIM_MS so
  // the exit transition can play.
  if (open && !mounted) setMounted(true)
  if (!open && shown) setShown(false)

  useEffect(() => {
    if (open) {
      // Double rAF: the first frame commits the initial `shown=false` styles;
      // the second flips to `shown=true` so the browser actually sees a
      // start→end change to transition (a single rAF gets batched into the
      // same paint as the mount, killing the enter animation).
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })

      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    const t = setTimeout(() => setMounted(false), ANIM_MS)

    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="titlebar-no-drag fixed inset-0 z-50 flex items-center justify-center"
      // Electron drag regions punch through normal z-index. Keep the whole
      // portal explicitly no-drag so a tall modal never lands its close button
      // over the app titlebar's drag hit-area.
      style={{ transform: 'translateZ(0)', willChange: 'transform' }}
    >
      {/*
        Solid translucent scrim — deliberately NO `backdrop-filter`. A
        backdrop-filter (blur) here composites over whatever is behind the modal;
        over a very tall virtualized table (1000+ rows → a ~50,000px scroll
        container) Chromium's backdrop-filter hit-testing breaks and swallows
        clicks aimed at the modal above it (the close button became dead once Raw
        JSON was expanded on the big Tencent/Aliyun lists — AWS's 5-row table was
        too small to trigger it). A plain scrim avoids the bug entirely. This
        element also serves as the click-outside-to-close target.
      */}
      <div
        aria-hidden
        onMouseDown={closeOnBackdrop ? onClose : undefined}
        className={clsx(
          // duration-150 must match ANIM_MS (see note at top of file).
          'titlebar-no-drag absolute inset-0 transition-opacity duration-150 ease-out',
          isLight ? 'bg-black/30' : 'bg-black/50',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        style={{ width }}
        className={clsx(
          'titlebar-no-drag relative isolate z-10 flex flex-col overflow-hidden border shadow-2xl',
          isPrompt ? 'rounded-[20px]' : 'rounded-xl',
          fillHeight ? 'h-[80vh]' : 'max-h-[80vh]',
          // duration-150 must match ANIM_MS (see note at top of file).
          'transition-[opacity,transform] duration-150 ease-out',
          shown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-1',
          isLight
            ? 'border-[rgb(208,206,212)] bg-white shadow-black/20'
            : 'border-zGray-800 bg-zGray-900 shadow-black/50',
        )}
      >
        <div
          className={clsx(
            // shrink-0 so a tall/scrolling body (e.g. expanded Raw JSON) can't
            // squeeze the header — which otherwise let the scrollable content
            // layer overlap the close button and swallow its clicks.
            'relative z-20 flex shrink-0 items-start',
            headerCompact ? 'px-4 py-2.5 pr-12' : 'px-5 py-4 pr-14',
            headerDivider &&
              !isPrompt && ['border-b', isLight ? 'border-[rgb(208,206,212)]' : 'border-zGray-800'],
          )}
        >
          <div className="min-w-0">
            <div
              className={clsx(
                isPrompt
                  ? 'text-xl font-semibold tracking-tight'
                  : headerCompact
                    ? 'text-[12.5px] font-medium'
                    : 'text-[14px] font-semibold',
                isLight ? 'text-[rgb(15,14,17)]' : headerCompact ? 'text-secondary' : 'text-main',
              )}
            >
              {title}
            </div>
            {description != null && (
              <div
                className={clsx(
                  isPrompt ? 'mt-1.5 text-sm leading-5' : 'mt-1 text-[12.5px] leading-5',
                  isLight ? 'text-[rgb(101,97,107)]' : 'text-secondary',
                )}
              >
                {description}
              </div>
            )}
          </div>
        </div>
        <div
          style={{ transform: 'translateZ(0)', willChange: 'transform' }}
          className={clsx(
            'titlebar-no-drag absolute z-50 flex items-center gap-0.5',
            headerCompact ? 'right-2 top-1.5' : 'right-3.5 top-3.5',
          )}
        >
          {headerActions}
          <button
            type="button"
            aria-label="Close modal"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className={clsx(
              'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors',
              isLight
                ? 'text-[rgb(126,122,133)] hover:bg-[rgb(245,244,245)] hover:text-[rgb(15,14,17)]'
                : 'text-tertiary hover:bg-zGray-800 hover:text-main',
            )}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        {/* min-h-0 lets this flex child shrink below its content and actually
            scroll internally, instead of forcing the column taller than 80vh
            and squeezing the header above. */}
        <div className="titlebar-no-drag relative z-0 min-h-0 flex-1 overflow-auto scrollbar-thin">
          {children}
        </div>
        {footer && (
          <div
            className={clsx(
              // shrink-0 pins the footer below the scrollable body.
              'relative z-20 shrink-0 border-t',
              isLight ? 'border-[rgb(208,206,212)]' : 'border-zGray-800',
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
