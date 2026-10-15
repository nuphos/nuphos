import clsx from 'clsx'
import {
  ArrowDownWideNarrow,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useRef, useState } from 'react'

import { PROJECT_NAME_MAX } from '../../lib/sidebar-projects/model'
import { SIDEBAR_ROW_CLASS } from '../SidebarNavItem'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'
import { Tooltip } from '../ui/tooltip'

import { endDrag, startDrag } from './chat-drag'

import type { ReactNode } from 'react'

const ROW_ACTION =
  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-tertiary opacity-0 transition-opacity hover:bg-[var(--sidebar-overlay-hover)] hover:text-main focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100 motion-reduce:transition-none'

/** Edits a project name in place: Enter or leaving the field saves, Escape keeps the old name. */
function ProjectNameInput({
  name,
  onDone,
}: {
  name: string
  onDone: (name: string | null) => void
}) {
  const [value, setValue] = useState(name)

  return (
    <input
      autoFocus
      aria-label="Project name"
      value={value}
      maxLength={PROJECT_NAME_MAX}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(value)
        if (event.key === 'Escape') onDone(null)
      }}
      className="min-w-0 flex-1 rounded border border-zGray-700 bg-main px-1 py-0.5 text-[14px] text-main outline-none focus:border-zViolet-500"
    />
  )
}

function ProjectMenu({
  name,
  manualOrder,
  onRename,
  onSortByRecent,
  onDelete,
}: {
  name: string
  manualOrder: boolean
  onRename: () => void
  onSortByRecent: () => void
  onDelete: () => void
}) {
  // Rename waits for the menu to finish closing, or focus returning to the
  // trigger would blur the new field, and blur saves it.
  const renameOnClose = useRef(false)

  return (
    <Menu
      onOpenChangeComplete={(open) => {
        if (open || !renameOnClose.current) return
        renameOnClose.current = false
        onRename()
      }}
    >
      <MenuTrigger aria-label={`Actions for ${name}`} className={ROW_ACTION}>
        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
      </MenuTrigger>
      <MenuContent align="start" className="w-[190px]">
        <MenuItem
          icon={<Pencil className="h-3.5 w-3.5" />}
          hint="F2"
          onClick={() => {
            renameOnClose.current = true
          }}
        >
          Rename project
        </MenuItem>
        {manualOrder && (
          <MenuItem icon={<ArrowDownWideNarrow className="h-3.5 w-3.5" />} onClick={onSortByRecent}>
            Sort by recent
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem destructive icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>
          Delete project
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** A project's folder row: toggles its chats, renames in place, drags to reorder, takes dropped chats. */
export function ProjectFolderRow({
  id,
  name,
  count,
  open,
  selected,
  manualOrder,
  renaming,
  dropOver,
  onToggle,
  onStartRename,
  onRename,
  onSortByRecent,
  onDelete,
  onNewChat,
}: {
  id: string
  name: string
  count: number
  open: boolean
  /** Folded over the open chat, so the folder stands in for it. */
  selected: boolean
  manualOrder: boolean
  renaming: boolean
  dropOver: boolean
  onToggle: () => void
  onStartRename: () => void
  onRename: (name: string | null) => void
  onSortByRecent: () => void
  onDelete: () => void
  onNewChat: () => void
}) {
  const Icon = open && count > 0 ? FolderOpen : Folder
  let tone = 'text-secondary hover:bg-[var(--sidebar-overlay-hover)]'

  if (selected) tone = 'bg-[var(--sidebar-overlay-active)] text-main'
  if (dropOver) tone = 'bg-zViolet-500/15 text-main ring-1 ring-inset ring-zViolet-500/50'
  let label: ReactNode = <ProjectNameInput name={name} onDone={onRename} />

  if (!renaming) {
    label = (
      <button
        type="button"
        aria-expanded={open}
        title={name}
        onClick={onToggle}
        onDoubleClick={onStartRename}
        onKeyDown={(event) => {
          if (event.key === 'F2') onStartRename()
        }}
        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none focus-visible:text-main"
      >
        <span className="truncate">{name}</span>
        {!open && count > 0 && (
          <span className="flex-shrink-0 text-[12px] text-tertiary tabular-nums">{count}</span>
        )}
      </button>
    )
  }

  return (
    <div
      draggable={!renaming}
      onDragStart={(event) => startDrag(event, 'project', id)}
      onDragEnd={endDrag}
      className={clsx(
        SIDEBAR_ROW_CLASS,
        'group flex items-center transition-colors focus-within:bg-[var(--sidebar-overlay-focus)] motion-reduce:transition-none',
        tone,
      )}
    >
      <span className="flex-shrink-0 text-tertiary group-hover:text-main [&_svg]:size-4">
        <Icon strokeWidth={1.8} />
      </span>
      {label}
      {!renaming && (
        <>
          <Tooltip content={`New chat in ${name}`} side="right">
            <button
              type="button"
              aria-label={`New chat in ${name}`}
              onClick={onNewChat}
              className={ROW_ACTION}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </Tooltip>
          <ProjectMenu
            name={name}
            manualOrder={manualOrder}
            onRename={onStartRename}
            onSortByRecent={onSortByRecent}
            onDelete={onDelete}
          />
        </>
      )}
    </div>
  )
}
