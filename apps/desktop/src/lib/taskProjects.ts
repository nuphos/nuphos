import { useSyncExternalStore } from 'react'

import { readAccountStorage, writeAccountStorage } from '../app/accountStorage.ts'

/*
 * A project is a folder on this computer. A task's own `workspace` places it in
 * one, so this list only keeps folders added here before they have a task. It
 * lives where the folders do: on this computer, per account and team.
 */
const storageKey = (teamId: string) => `nuphos.taskProjects.${teamId}`
const added = new Map<string, string[]>()
const listeners = new Set<() => void>()
let next: { teamId: string; path: string } | null = null

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function parseProjects(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')

    return Array.isArray(value) ? value.filter((path) => typeof path === 'string') : []
  } catch {
    return []
  }
}

export function addedProjects(teamId: string): string[] {
  let list = added.get(teamId)

  if (!list) {
    list = parseProjects(readAccountStorage(storageKey(teamId)))
    added.set(teamId, list)
  }

  return list
}

function save(teamId: string, list: string[]) {
  added.set(teamId, list)
  writeAccountStorage(storageKey(teamId), JSON.stringify(list))
  emit()
}

export function addProject(teamId: string, path: string) {
  if (!addedProjects(teamId).includes(path)) save(teamId, [...addedProjects(teamId), path])
}

export function removeProject(teamId: string, path: string) {
  save(
    teamId,
    addedProjects(teamId).filter((p) => p !== path),
  )
}

/** The project the next new task starts in: set by a project's "+", cleared by plain New task. */
export function startNextTaskIn(teamId: string, path: string | null) {
  next = path ? { teamId, path } : null
  emit()
}

export function nextTaskProject(teamId: string | undefined): string | null {
  return next && next.teamId === teamId ? next.path : null
}

/** Takes the folder the task being started works in; only an agent on a computer has folders. */
export function takeNextTaskWorkspace(teamId: string | undefined, runtime: { kind: string }) {
  const path = nextTaskProject(teamId)

  if (path) startNextTaskIn(teamId!, null)

  return path && runtime.kind === 'local' ? { kind: 'folder' as const, path } : undefined
}

export function useAddedProjects(teamId: string): string[] {
  return useSyncExternalStore(subscribe, () => addedProjects(teamId))
}

export function useNextTaskProject(teamId: string | undefined): string | null {
  return useSyncExternalStore(subscribe, () => nextTaskProject(teamId))
}

/** A folder's own name, as the sidebar lists its project. */
export function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
