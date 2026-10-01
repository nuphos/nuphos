import { Checkbox } from '../components/ui/checkbox'

import type { PosthogProject } from '../types'

function groupByOrganization(projects: PosthogProject[]) {
  const groups = new Map<string, { name: string; projects: PosthogProject[] }>()

  for (const project of projects) {
    const group = groups.get(project.organizationId) ?? {
      name: project.organizationName ?? project.organizationId,
      projects: [],
    }

    group.projects.push(project)
    groups.set(project.organizationId, group)
  }

  return [...groups.entries()]
}

export function PosthogProjectChecklist({
  projects,
  selectedIds,
  onChange,
  disabled,
}: {
  projects: PosthogProject[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  disabled?: boolean
}) {
  const selected = new Set(selectedIds)

  function toggle(id: number, checked: boolean) {
    const next = new Set(selected)

    if (checked) next.add(id)
    else next.delete(id)
    onChange(projects.map((project) => project.id).filter((projectId) => next.has(projectId)))
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-md border border-zGray-800 px-3 py-3 text-[12px] text-tertiary">
        This key cannot see any projects. Check the key's organization and project access.
      </div>
    )
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-zGray-800">
      {groupByOrganization(projects).map(([organizationId, group], groupIndex) => (
        <div key={organizationId} className={groupIndex > 0 ? 'border-t border-zGray-800' : ''}>
          <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-tertiary">
            {group.name}
          </div>
          {group.projects.map((project) => (
            <label
              key={project.id}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-zGray-850/70"
            >
              <Checkbox
                checked={selected.has(project.id)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(project.id, checked)}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-main">
                {project.name}
              </span>
              <span className="font-mono text-[10.5px] text-tertiary">{project.id}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
