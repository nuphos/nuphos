import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useStableCallback } from '../../../hooks/useStableCallback'

import {
  ARTIFACT_FRAME_SANDBOX,
  ARTIFACT_THUMBNAIL_SANDBOX,
  artifactSrcDoc,
  parseArtifactClick,
  readArtifactFrameMessage,
} from './artifactSandbox'

import type { ArtifactClick } from './artifactSandbox'

/** An HTML artifact, live, in its sandbox. Pages are drawn on white unless they paint their own ground. */
export function ArtifactFrame({
  html,
  title,
  onError,
  onEscape,
  onArrow,
  onClickTarget,
  className,
  sandbox = ARTIFACT_FRAME_SANDBOX,
}: {
  html: string
  title: string
  onError?: (message: string) => void
  /** Escape pressed while the page had the keyboard; the frame around it may want to step back. */
  onEscape?: () => void
  /** Left or right pressed in the page outside a field, and the page left it alone. */
  onArrow?: (direction: 'left' | 'right') => void
  /** Every click inside the page: what was clicked, so a prototype can follow it. */
  onClickTarget?: (click: ArtifactClick) => void
  className?: string
  sandbox?: string
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const channel = useMemo(() => crypto.randomUUID(), [])
  const srcDoc = useMemo(() => artifactSrcDoc(html, channel), [html, channel])
  const report = useStableCallback((message: string) => onError?.(message))
  const escape = useStableCallback(() => onEscape?.())
  const arrow = useStableCallback((message: string) => {
    if (message === 'left' || message === 'right') onArrow?.(message)
  })
  const clicked = useStableCallback((message: string) => {
    const click = parseArtifactClick(message)

    if (click) onClickTarget?.(click)
  })

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const own: MessageEventSource | null = frame.current?.contentWindow ?? null

      if (!own || event.source !== own) return
      const message = readArtifactFrameMessage(event.data, channel)

      if (message?.type === 'escape') escape()
      else if (message?.type === 'arrow') arrow(message.message)
      else if (message?.type === 'click') clicked(message.message)
      else if (message) report(message.message)
    }

    window.addEventListener('message', receive)

    return () => window.removeEventListener('message', receive)
  }, [channel, report, escape, arrow, clicked])

  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={srcDoc}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      className={clsx('block border-0 bg-white [color-scheme:light]', className)}
    />
  )
}

const THUMB_WIDTH = 1280

/**
 * The top of a page at desktop width, scaled into the card. It only loads once
 * the card scrolls into view, and never takes focus or clicks.
 */
export function ArtifactThumbnail({ html, title }: { html: string; title: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const node = box.current

    if (!node) return
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    const reveal = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin: '200px' },
    )

    resize.observe(node)
    reveal.observe(node)

    return () => {
      resize.disconnect()
      reveal.disconnect()
    }
  }, [])

  const scale = width / THUMB_WIDTH

  return (
    <span ref={box} aria-hidden inert className="pointer-events-none absolute inset-0 bg-white">
      {seen && width > 0 && (
        <span
          className="absolute left-0 top-0 block origin-top-left"
          style={{
            width: THUMB_WIDTH,
            height: `${String(100 / scale)}%`,
            transform: `scale(${String(scale)})`,
          }}
        >
          <ArtifactFrame
            html={html}
            title={title}
            className="h-full w-full"
            sandbox={ARTIFACT_THUMBNAIL_SANDBOX}
          />
        </span>
      )}
    </span>
  )
}
