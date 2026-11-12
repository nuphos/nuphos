import clsx from 'clsx'
import { PinOff } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { SESSION_DRAG_TYPE } from '../../app/workspace/splitLayout'
import { t } from '../../i18n'
import { ContextMenu } from '../ContextMenu'

import { BOT_PIN_DRAG_TYPE } from './bot-pin-drag'
import { previewPinOrder } from './bot-pin-order'
import { BotPinFace } from './BotPinFace'
import { setRowDragImage } from './rowDragImage'
import { SidebarPinShelf } from './SidebarPinShelf'
import { useBotPinDrag } from './useBotPinDrag'
import { usePinPreview } from './usePinPreview'

import type { Item } from './types'
import type { ReactNode } from 'react'

type Props = {
  order?: string[]
  onPlace?: (item: Item, before: Item | null) => void
  bots: Item[]
  pinned: (item: Item) => boolean
  toggle: (item: Item) => void
  onSelect: (key: string) => void
  teamId: string
  children: ReactNode
}

/** Pins share the existing personal, team-scoped Favorites store. */
export function SidebarBotPins({
  bots,
  pinned,
  toggle,
  onSelect,
  teamId,
  children,
  order = [],
  onPlace,
}: Props) {
  const pins = bots.filter(pinned).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  const {
    zone: pinZone,
    columns: availableColumns,
    cellWidth,
    preview: pinPreview,
    move: movePin,
    commit: commitPin,
    reset: resetPin,
  } = usePinPreview(pins, (item, before) => {
    if (onPlace) onPlace(item, before)
    else if (!pinned(item)) toggle(item)
  })
  const { dragged, setDragged, ghost, ...pointerHandlers } = useBotPinDrag(
    bots,
    pinned,
    toggle,
    (bot, target, x, y) => {
      const dataTransfer = new DataTransfer()

      dataTransfer.effectAllowed = 'copyMove'

      dataTransfer.setData(
        SESSION_DRAG_TYPE,
        JSON.stringify({ sessionId: bot.key.replace('agent-session:', ''), teamId }),
      )
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }

      target.dispatchEvent(new DragEvent('dragenter', init))
      target.dispatchEvent(new DragEvent('dragover', init))
      requestAnimationFrame(() => target.dispatchEvent(new DragEvent('drop', init)))
    },
    { onMove: movePin, onPinDrop: commitPin, onEnd: resetPin },
  )
  const [over, setOver] = useState(false)
  const [menu, setMenu] = useState<{ bot: Item; x: number; y: number } | null>(null)
  const draggedBot = bots.find((bot) => bot.key === dragged)
  const preview = pinPreview && pinPreview.key === draggedBot?.key ? pinPreview.before : undefined
  const displayPins = previewPinOrder(pins, draggedBot, preview)
  const columns = Math.max(1, Math.min(displayPins.length, availableColumns))
  const rows = Math.max(1, Math.ceil(displayPins.length / columns))

  const dropBot = (data: DataTransfer) =>
    bots.find((bot) => bot.key === data.getData(BOT_PIN_DRAG_TYPE))

  return (
    <div {...pointerHandlers} className="flex min-h-full select-none flex-col">
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { key: 'unpin', label: t('Unpin Bot'), icon: PinOff, onSelect: () => toggle(menu.bot) },
          ]}
        />
      )}
      {draggedBot &&
        createPortal(
          <div
            ref={ghost}
            className="pointer-events-none fixed left-0 top-0 z-[9999] flex w-[88px] flex-col items-center gap-1 rounded-xl bg-surface-raised/90 p-2 shadow-lg"
          >
            <BotPinFace item={draggedBot} size={Math.min(56, cellWidth - 20)} />
            <span className="w-full truncate text-center text-[11px] text-main">
              {draggedBot.label}
            </span>
          </div>,
          document.body,
        )}
      <SidebarPinShelf open={Boolean(pins.length || draggedBot)}>
        <div
          ref={pinZone}
          data-bot-pin-zone
          aria-label={t('Pinned Bots')}
          style={{
            gridTemplateColumns: `repeat(${String(columns)}, ${String(cellWidth)}px)`,
            gridTemplateRows: `repeat(${String(rows)}, ${String(cellWidth)}px)`,
            gridAutoFlow: 'row',
          }}
          className={clsx(
            'relative grid justify-center gap-1 rounded-xl p-1 transition-colors',
            (over || draggedBot) && 'bg-state-hover',
          )}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(BOT_PIN_DRAG_TYPE)) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'move'
            setOver(true)
            if (dragged) movePin(dragged, event.clientX, event.clientY)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
          }}
          onDrop={(event) => {
            const bot = dropBot(event.dataTransfer)

            if (!bot) return
            event.preventDefault()
            event.stopPropagation()
            commitPin(bot)
            setDragged(null)
            setOver(false)
          }}
        >
          {displayPins.map((bot) => (
            <div
              key={bot.key}
              data-pin-slot={bot.key}
              className={clsx('relative shrink-0', bot.key === dragged && 'opacity-60')}
              style={{ width: cellWidth }}
            >
              <button
                data-bot-pin-key={bot.key}
                draggable
                title={bot.label}
                aria-label={bot.label}
                onClick={(event) =>
                  bot.onActivate
                    ? bot.onActivate(event.metaKey || event.ctrlKey)
                    : onSelect(bot.key)
                }
                onContextMenu={(event) => {
                  event.preventDefault()
                  setMenu({ bot, x: event.clientX, y: event.clientY })
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copyMove'
                  event.dataTransfer.setData(BOT_PIN_DRAG_TYPE, bot.key)
                  const sessionId = bot.key.replace('agent-session:', '')

                  event.dataTransfer.setData(
                    SESSION_DRAG_TYPE,
                    JSON.stringify({ sessionId, teamId }),
                  )
                  setRowDragImage(
                    event,
                    event.currentTarget.parentElement ?? event.currentTarget,
                    bot.label,
                  )
                }}
                style={{ height: cellWidth }}
                className={clsx(
                  'flex w-full flex-col items-center justify-center gap-1 rounded-xl hover:bg-state-hover focus-visible:outline focus-visible:outline-line-focus',
                  bot.active && 'bg-state-selected',
                )}
              >
                <BotPinFace item={bot} size={Math.min(56, cellWidth - 20)} />
                <span className="w-full truncate px-1 text-center text-[12px] leading-4 text-secondary">
                  {bot.label}
                </span>
              </button>
            </div>
          ))}
        </div>
      </SidebarPinShelf>
      <div
        data-bot-pin-list
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(BOT_PIN_DRAG_TYPE)) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={(event) => {
          const bot = dropBot(event.dataTransfer)

          if (!bot) return
          event.preventDefault()
          event.stopPropagation()
          if (pinned(bot)) toggle(bot)
          setDragged(null)
        }}
        className="min-h-24 flex-1"
      >
        {children}
      </div>
    </div>
  )
}
