import clsx from 'clsx'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'

import {
  SIDEBAR_GROUP_GAP_CLASS,
  SIDEBAR_GROUP_ITEMS_CLASS,
  SIDEBAR_GROUP_TITLE_CLASS,
} from '../SidebarNavItem'
import { Tooltip } from '../ui/tooltip'

import { useDropTarget } from './chat-drag'
import { SidebarSectionSkeleton } from './parts'
import { SidebarRows } from './section-rows'
import { SidebarProjects } from './sidebar-projects'

import type { SidebarRowsContext } from './section-rows'
import type { Section } from './types'
import type { SidebarProjectsController } from './use-sidebar-projects'

type SectionListProps = SidebarRowsContext & {
  sections: Section[]
  /** Absent outside team view, where chats are not organized. */
  projects?: SidebarProjectsController
}

function SectionHeading({
  title,
  collapsed,
  onToggle,
  onNewProject,
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  onNewProject?: () => void
}) {
  return (
    <div className="group/heading flex items-center">
      <button
        type="button"
        onPointerDown={(event) => {
          if (event.button === 0) onToggle()
        }}
        onClick={(event) => {
          if (event.detail === 0) onToggle()
        }}
        className={clsx(
          SIDEBAR_GROUP_TITLE_CLASS,
          'flex-1 min-w-0 hover:text-secondary flex items-center gap-1.5',
        )}
      >
        <span className="text-left">{title}</span>
        <span className="t-icon-swap w-3 h-3 flex-shrink-0" data-state={collapsed ? 'a' : 'b'}>
          <ChevronRight className="t-icon w-3 h-3" data-icon="a" />
          <ChevronDown className="t-icon w-3 h-3" data-icon="b" />
        </span>
      </button>
      {onNewProject && (
        <Tooltip content="New project" side="right">
          <button
            type="button"
            aria-label="New project"
            onClick={onNewProject}
            className="mr-1.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-tertiary opacity-0 transition-opacity hover:bg-[var(--sidebar-overlay-hover)] hover:text-main focus-visible:opacity-100 group-hover/heading:opacity-100 motion-reduce:transition-none"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function SidebarSection({
  section,
  rows,
  projects,
}: {
  section: Section
  rows: SidebarRowsContext
  projects?: SidebarProjectsController
}) {
  const { isGroupCollapsed, toggleGroup } = rows
  // A project being named stays in view even inside a folded Projects group.
  const collapsed = isGroupCollapsed(section) && !(section.projects && projects?.renamingId)
  // Dropping a filed chat on Chats takes it out of its project.
  const drop = useDropTarget({
    kind: 'chat',
    onDrop:
      projects && section.title === 'Chats'
        ? (sessionId) => projects.move(sessionId, null)
        : undefined,
    accepts: (sessionId) => Boolean(projects?.projectOf(sessionId)),
  })

  let body = <SidebarRows items={section.items} {...rows} />

  if (section.loading) body = <SidebarSectionSkeleton />
  else if (section.projects && projects)
    body = <SidebarProjects groups={section.projects} rows={rows} projects={projects} />

  return (
    <div
      {...drop.props}
      className={clsx(
        'rounded-lg transition-[margin-bottom,background-color] duration-200 motion-reduce:transition-none',
        collapsed ? 'mb-1' : SIDEBAR_GROUP_GAP_CLASS,
        drop.over && 'bg-zViolet-500/10 ring-1 ring-inset ring-zViolet-500/40',
      )}
    >
      {section.title && (
        <SectionHeading
          title={section.title}
          collapsed={collapsed}
          onToggle={() => toggleGroup(section)}
          onNewProject={section.projects && projects ? () => projects.create() : undefined}
        />
      )}
      <div className="t-collapse" data-open={collapsed ? 'false' : 'true'}>
        <div className="t-collapse-inner">
          <div
            className={clsx(SIDEBAR_GROUP_ITEMS_CLASS, 't-panel-slide [--panel-translate-y:8px]')}
            data-open="true"
          >
            {body}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SidebarSectionList({ sections, projects, ...rows }: SectionListProps) {
  return (
    <>
      {sections.map((section, idx) => (
        <SidebarSection key={idx} section={section} rows={rows} projects={projects} />
      ))}
    </>
  )
}
