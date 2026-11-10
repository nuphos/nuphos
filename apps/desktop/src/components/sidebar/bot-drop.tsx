import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'
import { makeBot } from '../channels/botChannel'

import type { ReactNode } from 'react'

/** Set on a Task row's drag when it can become a Bot; its value is the session id. */
export const MAKE_BOT_DRAG_TYPE = 'application/x-nuphos-make-bot'
/**
 * Bots as a drop target: a Task dropped on it becomes a Bot, as "Make this a
 * Bot" does. The Task keeps running and stays in Tasks; it gains a face and a
 * chat here, so the drop copies rather than moves. While such a drag is under
 * way the group shows where to drop; over any part of it, it lights up. Other
 * groups render as a plain wrapper.
 */
export function BotsDropZone({
  enabled,
  teamId,
  className,
  children,
}: {
  enabled: boolean
  teamId: string
  className?: string
  /** Renders the group; `slot` is where the drop hint opens, under the group's title. */
  children: (slot: ReactNode) => ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState(false)
  // dragenter and dragleave fire for every child crossed, so count them.
  const depth = useRef(0)
  const type = enabled ? MAKE_BOT_DRAG_TYPE : null

  useEffect(() => {
    if (!type) return
    const start = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(type)) setDragging(true)
    }
    const end = () => {
      depth.current = 0
      setDragging(false)
      setOver(false)
    }

    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)

    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [type])

  if (!type) return <div className={className}>{children(null)}</div>

  return (
    <div
      // The whole group takes the drop, and shows it: over any part of it, the
      // group fills and its hint firms up.
      className={clsx(
        className,
        'rounded-xl -outline-offset-1 transition-colors duration-150',
        over && 'bg-state-hover outline outline-1 outline-line-focus',
      )}
      // Accepting dragenter as well as dragover keeps the group the drop target
      // over its rows too; otherwise the browser hands the drag to the body.
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes(type)) return
        event.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(type)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes(type)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(event) => {
        const sessionId = event.dataTransfer.getData(type)

        if (!sessionId) return
        event.preventDefault()
        event.stopPropagation()
        depth.current = 0
        setDragging(false)
        setOver(false)
        void makeBot(teamId, sessionId)
      }}
    >
      {children(
        // Opens under the title as the drag starts and closes when it ends, so
        // the rows below slide rather than jump; over it, the dashed edge firms up.
        <div className="t-collapse" data-open={dragging ? 'true' : 'false'}>
          <div className="t-collapse-inner">
            <div
              className={clsx(
                'mx-0.5 mb-1.5 mt-1 flex h-12 items-center justify-center rounded-xl border text-[12.5px] transition-colors duration-150',
                over
                  ? 'border-transparent text-secondary'
                  : 'border-dashed border-line-control text-tertiary',
              )}
            >
              <span className="flex flex-col items-center leading-tight">
                <span>{t('Drop to make it a Bot')}</span>
                <span className="text-[11.5px] text-tertiary">
                  {t('It keeps running in Tasks')}
                </span>
              </span>
            </div>
          </div>
        </div>,
      )}
    </div>
  )
}
