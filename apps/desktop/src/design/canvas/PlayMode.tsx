import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { ArtifactFrame } from '../../components/agent/artifacts/ArtifactFrame'
import { Button } from '../../components/ui/button'
import { Kbd } from '../../components/ui/kbd'
import { useElementSize } from '../../grafana/useElementSize'
import { t } from '../../i18n'

import { playFitScale } from './playFit'
import { playTarget } from './playTarget'

import type { DesignFrame, DesignPage } from '../schema'

// One sentence for translators; each {key} becomes a key cap (odd split parts).
const PLAY_HINT = t(
  'Click the screen to follow its links, {left} {right} to move, {esc} to leave',
).split(/\{(left|right|esc)\}/)

const STAGE_PAD = 24

type Props = {
  page: DesignPage
  startId: string
  onClose: () => void
}

/**
 * The flow at full size: one screen at a time, its outgoing links as buttons,
 * arrow keys to walk the order the links give. The screen is live, and clicking
 * in it follows the link it means (see playTarget). A screen bigger than the
 * window shrinks to fit, so its bottom (often the call to action) stays in view.
 */
export function PlayMode({ page, startId, onClose }: Props) {
  const frames = useMemo(
    () => page.objects.filter((o): o is DesignFrame => o.type === 'frame'),
    [page.objects],
  )
  // The walk order: from the start, follow first links depth-first, then any
  // screen the links never reach, in canvas order.
  const order = useMemo(() => {
    const byId = new Map(frames.map((f) => [f.id, f]))
    const seen = new Set<string>()
    const out: string[] = []
    const visit = (id: string) => {
      if (seen.has(id) || !byId.has(id)) return
      seen.add(id)
      out.push(id)
      for (const link of page.links) if (link.source === id) visit(link.target)
    }

    visit(startId)
    for (const f of [...frames].sort((a, b) => a.y - b.y || a.x - b.x)) visit(f.id)

    return out
  }, [frames, page.links, startId])
  const [currentId, setCurrentId] = useState(startId)
  const [history, setHistory] = useState<string[]>([])
  const current = frames.find((f) => f.id === currentId) ?? frames[0]
  const index = order.indexOf(currentId)
  const outgoing = page.links.filter((l) => l.source === currentId)
  const { ref: stageRef, width: stageWidth, height: stageHeight } = useElementSize<HTMLDivElement>()

  const go = (id: string) => {
    setHistory((h) => [...h, currentId])
    setCurrentId(id)
  }
  const back = () => {
    const prev = history.at(-1)

    if (prev) {
      setHistory((h) => h.slice(0, -1))
      setCurrentId(prev)
    } else if (index > 0) setCurrentId(order[index - 1]!)
  }
  const next = () => {
    const target = outgoing[0]?.target ?? order[index + 1]

    if (target) go(target)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
      else return
      e.preventDefault()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return null
  // The stage pads the screen by STAGE_PAD on every side.
  const scale = playFitScale(current, {
    width: stageWidth - 2 * STAGE_PAD,
    height: stageHeight - 2 * STAGE_PAD,
  })

  return createPortal(
    <div
      className="fixed inset-0 z-[900] flex flex-col bg-[#101013] text-white"
      role="dialog"
      aria-label={t('Play')}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <span className="truncate text-[13px] font-medium">{current.title}</span>
        <span className="text-[12px] text-white/50">
          {String(index + 1)} / {String(order.length)}
        </span>
        <span className="flex-1" />
        <span className="hidden items-center gap-1 text-[11px] text-white/50 sm:inline-flex">
          {PLAY_HINT.map((part, i) => (i % 2 ? <Kbd key={part} combo={part} /> : part))}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('Close')}
          className="text-white hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ padding: STAGE_PAD }}
      >
        <div
          className="shrink-0 overflow-hidden rounded-md bg-white shadow-[0_12px_48px_rgba(0,0,0,0.6)]"
          style={{ width: current.width * scale, height: current.height * scale }}
        >
          <div
            style={{
              width: current.width,
              height: current.height,
              transform: `scale(${String(scale)})`,
              transformOrigin: 'top left',
            }}
          >
            <ArtifactFrame
              key={current.id}
              html={current.html}
              title={current.title}
              className="h-full w-full"
              // A click inside the screen moves focus into it; Esc and ← → still work.
              onEscape={onClose}
              onArrow={(direction) => (direction === 'left' ? back() : next())}
              onClickTarget={(click) => {
                const target = playTarget(click, outgoing, frames)

                if (target) go(target)
              }}
            />
          </div>
        </div>
      </div>
      <div className="flex h-14 shrink-0 items-center justify-center gap-2 border-t border-white/10 px-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-white hover:bg-white/10 hover:text-white"
          disabled={history.length === 0 && index <= 0}
          onClick={back}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {outgoing.length > 0 ? (
          outgoing.map((link) => {
            const target = frames.find((f) => f.id === link.target)

            return (
              <Button key={link.id} variant="primary" size="sm" onClick={() => go(link.target)}>
                {link.label || `Go to ${target?.title ?? 'screen'}`}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )
          })
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 hover:text-white"
            disabled={index < 0 || index >= order.length - 1}
            onClick={next}
          >
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>,
    document.body,
  )
}
