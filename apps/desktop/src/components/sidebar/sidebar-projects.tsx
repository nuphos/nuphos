import clsx from 'clsx'
import { FolderPlus, SquarePen } from 'lucide-react'
import { useState } from 'react'

import { placeBeside } from '../../lib/sidebar-projects/model'
import { SIDEBAR_ROW_CLASS } from '../SidebarNavItem'
import { AppAlertDialog } from '../ui/alert-dialog'

import { useDropTarget } from './chat-drag'
import { DropLine } from './drop-line'
import { ProjectFolderRow } from './project-folder-row'
import { SidebarRows } from './section-rows'

import type { SidebarRowsContext } from './section-rows'
import type { Item } from './types'
import type { SidebarProjectsController } from './use-sidebar-projects'

type ProjectGroup = { id: string; name: string; manualOrder: boolean; items: Item[] }

const DROP_INTO = 'bg-zViolet-500/15 text-main ring-1 ring-inset ring-zViolet-500/50'
const sessionOf = (item: Item) => item.key.slice('agent-session:'.length)

const SHOWN_CHATS = 5

/** A long project shows its first chats and the open one; threads go with their chat. */
function trimmed(items: Item[], listed: string[], showAll: boolean): Item[] {
  const byKey = new Map(items.map((item) => [item.key, item]))
  const topOf = (item: Item): string => {
    const parent = item.parentKey ? byKey.get(item.parentKey) : undefined

    return parent && parent !== item ? topOf(parent) : sessionOf(item)
  }
  const shown = new Set(showAll ? listed : listed.slice(0, SHOWN_CHATS))

  for (const item of items) if (item.active) shown.add(topOf(item))

  return items.filter((item) => shown.has(topOf(item)))
}

/** The chats filed in a project in the order shown, without their threads. */
function listedChats(items: Item[]): string[] {
  const keys = new Set(items.map((item) => item.key))

  return items.filter((item) => !item.parentKey || !keys.has(item.parentKey)).map(sessionOf)
}

function NewChatPlaceholder() {
  return (
    <div
      className={clsx(SIDEBAR_ROW_CLASS, 'flex items-center bg-[var(--sidebar-overlay-active)]')}
    >
      <SquarePen className="size-4 flex-shrink-0 text-main" strokeWidth={1.8} />
      <span className="truncate text-main">New chat</span>
    </div>
  )
}

function ProjectFolder({
  group,
  rows,
  projects,
  onDelete,
}: {
  group: ProjectGroup
  rows: SidebarRowsContext
  projects: SidebarProjectsController
  onDelete: () => void
}) {
  // Remembered per team like any sidebar group.
  const fold = { title: `project:${group.id}` }
  const open = !rows.isGroupCollapsed(fold)
  const listed = listedChats(group.items)
  const into = useDropTarget({
    kind: 'chat',
    onDrop: (sessionId) => projects.move(sessionId, group.id),
    accepts: (sessionId) => projects.projectOf(sessionId)?.id !== group.id,
  })
  const arrange = useDropTarget({
    kind: 'project',
    sided: true,
    accepts: (id) => id !== group.id,
    onDrop: (id, position) => {
      const ids = projects.list.map((project) => project.id)

      if (position !== 'inside') projects.arrange(placeBeside(ids, id, group.id, position))
    },
  })
  const reorder = (dragged: string, target: string, position: 'before' | 'after') => {
    if (projects.projectOf(dragged)?.id !== group.id) projects.move(dragged, group.id)
    projects.order(group.id, placeBeside(listed, dragged, target, position))
  }
  const newChatHere = projects.newChatProjectId === group.id
  const [showAll, setShowAll] = useState(false)
  const items = trimmed(group.items, listed, showAll)
  const hiddenCount = listed.length - listedChats(items).length

  return (
    <div {...arrange.props} className="relative">
      <div className="t-collapse t-sidebar-session t-stagger is-shown" data-open="true">
        <div className="t-collapse-inner t-stagger-line">
          <div {...into.props}>
            <ProjectFolderRow
              id={group.id}
              name={group.name}
              count={listed.length}
              open={open}
              selected={!open && group.items.some((item) => item.active)}
              manualOrder={group.manualOrder}
              renaming={projects.renamingId === group.id}
              dropOver={into.over !== null}
              onToggle={() => rows.toggleGroup(fold)}
              onStartRename={() => projects.setRenamingId(group.id)}
              onRename={(name) => {
                projects.setRenamingId(null)
                const next = name?.trim()

                if (next && next !== group.name) projects.rename(group.id, next)
              }}
              onSortByRecent={() => projects.sortByRecent(group.id)}
              onDelete={onDelete}
              onNewChat={() => {
                if (!open) rows.toggleGroup(fold)
                projects.newChatIn(group.id)
              }}
            />
          </div>
          <div className="t-collapse" data-open={open || newChatHere ? 'true' : 'false'}>
            <div className="t-collapse-inner">
              <div className="space-y-0.5 pt-0.5 pl-4">
                {newChatHere && <NewChatPlaceholder />}
                {items.length > 0 && <SidebarRows items={items} {...rows} reorder={reorder} />}
                {(hiddenCount > 0 || showAll) && listed.length > SHOWN_CHATS && (
                  <button
                    type="button"
                    onClick={() => setShowAll(!showAll)}
                    className="w-full rounded-lg px-2 py-1 text-left text-[12px] text-tertiary transition-colors hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary motion-reduce:transition-none"
                  >
                    {showAll ? 'Show less' : `Show ${String(hiddenCount)} more`}
                  </button>
                )}
                {group.items.length === 0 && !newChatHere && (
                  <p className="px-2 py-1.5 text-[12px] text-tertiary">
                    No chats yet. Drag one here or press +.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <DropLine position={arrange.over} />
    </div>
  )
}

/** First run: one row that starts a project, or files a dropped chat into a new one. */
function NewProjectRow({ projects }: { projects: SidebarProjectsController }) {
  const drop = useDropTarget({ kind: 'chat', onDrop: (sessionId) => projects.create(sessionId) })

  return (
    <button
      type="button"
      {...drop.props}
      onClick={() => projects.create()}
      className={clsx(
        SIDEBAR_ROW_CLASS,
        'w-full flex items-center text-tertiary transition-colors hover:text-main motion-reduce:transition-none',
        drop.over ? DROP_INTO : 'hover:bg-[var(--sidebar-overlay-hover)]',
      )}
    >
      <FolderPlus className="size-4 flex-shrink-0" strokeWidth={1.8} />
      <span className="truncate">{drop.over ? 'Drop to start a project' : 'New project'}</span>
    </button>
  )
}

/** The Projects group: one folder per project, each holding its chats and their threads. */
export function SidebarProjects({
  groups,
  rows,
  projects,
}: {
  groups: ProjectGroup[]
  rows: SidebarRowsContext
  projects: SidebarProjectsController
}) {
  const [deleting, setDeleting] = useState<ProjectGroup | null>(null)
  const filed = deleting ? listedChats(deleting.items).length : 0
  const chats = filed === 1 ? 'Its chat goes' : `Its ${String(filed)} chats go`

  return (
    <>
      {groups.length === 0 ? (
        <NewProjectRow projects={projects} />
      ) : (
        groups.map((group) => (
          <ProjectFolder
            key={group.id}
            group={group}
            rows={rows}
            projects={projects}
            onDelete={() => setDeleting(group)}
          />
        ))
      )}
      <AppAlertDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          filed > 0
            ? `${chats} back to Chats. Nothing is archived or deleted.`
            : 'The project is empty. No chats are affected.'
        }
        confirmLabel="Delete project"
        destructive
        onConfirm={() => {
          if (deleting) projects.remove(deleting.id)
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
