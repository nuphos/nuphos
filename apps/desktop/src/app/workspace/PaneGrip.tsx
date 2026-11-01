import { t } from '../../i18n'

import { PANE_DRAG_TYPE } from './splitLayout'

import type { DragEvent } from 'react'

/** A chip naming the pane follows the pointer instead of a snapshot of the header. */
function setPaneDragImage(event: DragEvent, label: string) {
  const chip = document.createElement('div')

  chip.className =
    'fixed -left-[999px] top-0 max-w-[240px] truncate rounded-lg border border-zGray-700 bg-elevated px-3 py-1.5 text-[12px] font-medium text-main shadow-lg'
  chip.textContent = label
  document.body.appendChild(chip)
  event.dataTransfer.setDragImage(chip, 16, 16)
  requestAnimationFrame(() => chip.remove())
}

/** Pill centred on the pane's top edge; only shown while the window is split. */
export function PaneGrip({ label }: { label?: string }) {
  return (
    <span
      draggable
      title={t('Drag to move this pane')}
      aria-hidden
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(PANE_DRAG_TYPE, 'pane')
        if (label) setPaneDragImage(event, label)
      }}
      className="titlebar-no-drag group/grip absolute left-1/2 top-0 z-10 hidden h-3 w-16 -translate-x-1/2 cursor-grab items-center justify-center active:cursor-grabbing group-data-[split-multiple=true]/pane:flex"
    >
      <span className="h-1 w-8 rounded-full bg-zGray-600 transition-[width,background-color] duration-150 group-hover/grip:w-11 group-hover/grip:bg-zGray-400 group-active/grip:bg-zViolet-400" />
    </span>
  )
}
