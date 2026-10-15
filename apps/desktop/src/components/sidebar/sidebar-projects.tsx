import clsx from 'clsx'
import { FolderPlus } from 'lucide-react'
import { useState } from 'react'

import { SIDEBAR_ROW_CLASS } from '../SidebarNavItem'
import { AppAlertDialog } from '../ui/alert-dialog'

import { useChatDropTarget } from './chat-drag'
import { ProjectFolderRow } from './project-folder-row'
import { SidebarRows } from './section-rows'

import type { SidebarRowsContext } from './section-rows'
import type { Item } from './types'
import type { SidebarProjectsController } from './use-sidebar-projects'

type ProjectGroup = { id: string; name: string; items: Item[] }

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
  const drop = useChatDropTarget(
    (sessionId) => projects.move(sessionId, group.id),
    (sessionId) => projects.projectOf(sessionId)?.id !== group.id,
  )
  const count = group.items.filter((item) => !item.parentKey).length

  return (
    <div {...drop.props}>
      <ProjectFolderRow
        name={group.name}
        count={count}
        open={open}
        renaming={projects.renamingId === group.id}
        dropOver={drop.over}
        onToggle={() => rows.toggleGroup(fold)}
        onStartRename={() => projects.setRenamingId(group.id)}
        onRename={(name) => {
          projects.setRenamingId(null)
          const next = name?.trim()

          if (next && next !== group.name) projects.rename(group.id, next)
        }}
        onDelete={onDelete}
      />
      <div className="t-collapse" data-open={open ? 'true' : 'false'}>
        <div className="t-collapse-inner">
          <div className="space-y-0.5 pt-0.5 pl-4">
            {group.items.length > 0 ? (
              <SidebarRows items={group.items} {...rows} />
            ) : (
              <p className="px-2 py-1.5 text-[12px] text-tertiary">No chats yet. Drag one here.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** First run: one row that starts a project, or files a dropped chat into a new one. */
function NewProjectRow({ projects }: { projects: SidebarProjectsController }) {
  const drop = useChatDropTarget((sessionId) => projects.create(sessionId))

  return (
    <button
      type="button"
      {...drop.props}
      onClick={() => projects.create()}
      className={clsx(
        SIDEBAR_ROW_CLASS,
        'w-full flex items-center text-tertiary transition-colors hover:text-main motion-reduce:transition-none',
        drop.over
          ? 'bg-zViolet-500/15 text-main ring-1 ring-inset ring-zViolet-500/50'
          : 'hover:bg-[var(--sidebar-overlay-hover)]',
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
  // Count what the project holds, not only the rows shown: archived and pinned chats are filed too.
  const filed = projects.list.find((project) => project.id === deleting?.id)?.sessionIds.length ?? 0
  const chats = filed === 1 ? 'Its chat leaves' : `Its ${String(filed)} chats leave`

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
            ? `${chats} the project. Nothing is archived or deleted.`
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
