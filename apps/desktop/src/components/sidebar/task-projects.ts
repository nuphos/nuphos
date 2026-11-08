import { CircleDashed, Folder } from 'lucide-react'

import { t } from '../../i18n/index.ts'
import { projectName } from '../../lib/taskProjects.ts'

import type { Item } from './types'

const NO_PROJECT_KEY = 'project:none'
const projectKey = (path: string) => `project:${path}`

/**
 * Tasks under their projects: one row per project folds its tasks, newest
 * project first, and tasks in none follow under No project. With no project
 * at all the list stays as it was.
 */
export function withProjects(
  tasks: Item[],
  added: readonly string[],
  rowProps: (key: string, path: string | null, empty: boolean) => Partial<Item>,
): Item[] {
  const paths = [...new Set([...tasks.flatMap((task) => task.projectPath ?? []), ...added])]

  if (paths.length === 0) return tasks
  const keys = new Set(tasks.map((task) => task.key))
  // A sub-agent stays under its parent; every other task goes under its project.
  const nested = tasks.map((task) =>
    task.parentKey && keys.has(task.parentKey)
      ? task
      : // Listed like any task, not counted as a finished sub-agent.
        {
          ...task,
          finished: false,
          parentKey: task.projectPath ? projectKey(task.projectPath) : NO_PROJECT_KEY,
        },
  )
  const row = (key: string, label: string, path: string | null): Item => ({
    key,
    label,
    icon: path ? Folder : CircleDashed,
    enabled: true,
    project: true,
    ...rowProps(key, path, !nested.some((task) => task.parentKey === key)),
  })
  const loose = nested.some((task) => task.parentKey === NO_PROJECT_KEY)

  return [
    ...paths.map((path) => row(projectKey(path), projectName(path), path)),
    ...(loose ? [row(NO_PROJECT_KEY, t('No project'), null)] : []),
    ...nested,
  ]
}
