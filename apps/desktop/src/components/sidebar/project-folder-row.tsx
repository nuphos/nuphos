import clsx from 'clsx'
import { Folder, FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { PROJECT_NAME_MAX } from '../../lib/sidebar-projects/model'
import { SIDEBAR_ROW_CLASS } from '../SidebarNavItem'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../ui/menu'

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

/** A project's folder row: toggles its chats, renames in place, and takes dropped chats. */
export function ProjectFolderRow({
  name,
  count,
  open,
  renaming,
  dropOver,
  onToggle,
  onStartRename,
  onRename,
  onDelete,
}: {
  name: string
  count: number
  open: boolean
  renaming: boolean
  dropOver: boolean
  onToggle: () => void
  onStartRename: () => void
  onRename: (name: string | null) => void
  onDelete: () => void
}) {
  const Icon = open && count > 0 ? FolderOpen : Folder
  // Rename waits for the menu to finish closing; focus returning to the
  // trigger would otherwise blur the new field, and blur saves it.
  const renameOnClose = useRef(false)

  return (
    <div
      className={clsx(
        SIDEBAR_ROW_CLASS,
        'group flex items-center text-secondary transition-colors motion-reduce:transition-none',
        dropOver
          ? 'bg-zViolet-500/15 text-main ring-1 ring-inset ring-zViolet-500/50'
          : 'hover:bg-[var(--sidebar-overlay-hover)]',
      )}
    >
      <span className="flex-shrink-0 text-tertiary group-hover:text-main [&_svg]:size-4">
        <Icon strokeWidth={1.8} />
      </span>
      {renaming ? (
        <ProjectNameInput name={name} onDone={onRename} />
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          onDoubleClick={onStartRename}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none focus-visible:text-main"
        >
          <span className="truncate">{name}</span>
          {!open && count > 0 && (
            <span className="flex-shrink-0 text-[12px] text-tertiary tabular-nums">{count}</span>
          )}
        </button>
      )}
      {!renaming && (
        <Menu
          onOpenChangeComplete={(menuOpen) => {
            if (menuOpen || !renameOnClose.current) return
            renameOnClose.current = false
            onStartRename()
          }}
        >
          <MenuTrigger
            aria-label={`Actions for ${name}`}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-tertiary opacity-0 transition-opacity hover:bg-[var(--sidebar-overlay-hover)] hover:text-main focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100 motion-reduce:transition-none"
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
          </MenuTrigger>
          <MenuContent align="start" className="w-[180px]">
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                renameOnClose.current = true
              }}
            >
              Rename project
            </MenuItem>
            <MenuSeparator />
            <MenuItem destructive icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete}>
              Delete project
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}
