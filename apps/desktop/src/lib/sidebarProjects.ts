import { api } from '../api.ts'

import { applyProjectChange, nextProjectName } from './sidebar-projects/model.ts'
import { createDocumentSync } from './sidebarDocumentSync.ts'

import type { SidebarProject, SidebarProjectChange } from './sidebar-projects/model.ts'
import type { DocumentSyncMeta } from './sidebarDocumentSync.ts'

export type { SidebarProject, SidebarProjectChange } from './sidebar-projects/model.ts'

const CACHE_STORAGE_KEY = 'nuphos.sidebarProjects.v2'
const SYNC_STORAGE_KEY = 'nuphos.sidebarProjects.sync.v2'
const CHANGE_EVENT = 'nuphos:sidebar-projects-changed'
const CREATED_EVENT = 'nuphos:sidebar-project-created'

type ProjectOperation = { id: string; change: SidebarProjectChange }

// Used when localStorage is unavailable or full, so the session still works.
const memory = new Map<string, unknown>()

function scopeKey(userId: string, teamId: string): string {
  return `${encodeURIComponent(userId)}|${encodeURIComponent(teamId)}`
}

function readRecord(storageKey: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as unknown

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function read(storageKey: string, scope: string): unknown {
  const key = `${storageKey}|${scope}`

  return memory.has(key) ? memory.get(key) : readRecord(storageKey)[scope]
}

function write(storageKey: string, scope: string, value: unknown): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...readRecord(storageKey), [scope]: value }))
    memory.delete(`${storageKey}|${scope}`)
  } catch {
    memory.set(`${storageKey}|${scope}`, value)
  }
}

function validProject(value: unknown): value is SidebarProject {
  const project = value as Partial<SidebarProject> | null

  return (
    typeof project?.id === 'string' &&
    typeof project.name === 'string' &&
    Array.isArray(project.sessionIds) &&
    project.sessionIds.every((id) => typeof id === 'string')
  )
}

function readItems(userId: string, teamId: string): SidebarProject[] {
  const value = read(CACHE_STORAGE_KEY, scopeKey(userId, teamId))

  return Array.isArray(value) ? value.filter(validProject) : []
}

function readMeta(userId: string, teamId: string): DocumentSyncMeta<ProjectOperation> {
  const value = read(SYNC_STORAGE_KEY, scopeKey(userId, teamId)) as
    Partial<DocumentSyncMeta<ProjectOperation>> | undefined

  return {
    migrated: true,
    revision: typeof value?.revision === 'number' ? value.revision : 0,
    pending: Array.isArray(value?.pending)
      ? value.pending.filter((op) => typeof op?.id === 'string' && Boolean(op.change))
      : [],
  }
}

function notify(userId: string, teamId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId, teamId } }))
}

function applyOperations(projects: SidebarProject[], operations: ProjectOperation[]) {
  return operations.reduce(
    (next, operation) => applyProjectChange(next, operation.change),
    projects,
  )
}

const projectsSync = createDocumentSync<SidebarProject, ProjectOperation>({
  conflictCode: 'sidebar_projects_changed',
  readItems,
  writeItems: (userId, teamId, items) => write(CACHE_STORAGE_KEY, scopeKey(userId, teamId), items),
  readMeta,
  writeMeta: (userId, teamId, meta) => write(SYNC_STORAGE_KEY, scopeKey(userId, teamId), meta),
  notify,
  get: async (teamId) => {
    const remote = await api.atlasGetSidebarProjects(teamId)

    return { items: remote.projects, revision: remote.revision }
  },
  put: async (teamId, items, revision) => {
    const saved = await api.atlasPutSidebarProjects(teamId, items, revision)

    return { items: saved.projects, revision: saved.revision }
  },
  apply: applyOperations,
})

/** This person's projects in this team, including changes still being saved. */
export function readSidebarProjects(userId: string, teamId: string): SidebarProject[] {
  return readItems(userId, teamId)
}

/** Applies a change locally right away; it is kept and retried until the server has it. */
export function updateSidebarProjects(
  userId: string,
  teamId: string,
  change: SidebarProjectChange,
): void {
  write(
    CACHE_STORAGE_KEY,
    scopeKey(userId, teamId),
    applyProjectChange(readItems(userId, teamId), change),
  )
  notify(userId, teamId)
  projectsSync.enqueue(userId, teamId, { id: globalThis.crypto.randomUUID(), change })
}

/** Reconciles with the server, replaying changes not yet saved on top of its copy. */
export function syncSidebarProjects(userId: string, teamId: string): Promise<void> {
  return projectsSync.sync(userId, teamId)
}

export function subscribeSidebarProjects(
  userId: string,
  teamId: string,
  onChange: () => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string; teamId?: string }>).detail

    if (detail.userId === userId && detail.teamId === teamId) onChange()
  }

  window.addEventListener(CHANGE_EVENT, handler)

  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

/**
 * Creates a project, optionally with a chat already in it, and tells the
 * sidebar so it can put the new name straight into edit mode.
 */
export function createSidebarProject(userId: string, teamId: string, sessionId?: string): string {
  const id = globalThis.crypto.randomUUID()
  const name = nextProjectName(readSidebarProjects(userId, teamId))

  updateSidebarProjects(userId, teamId, { kind: 'create', id, name, sessionId })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CREATED_EVENT, { detail: { userId, teamId, id } }))
  }

  return id
}

export function onSidebarProjectCreated(
  userId: string,
  teamId: string,
  onCreated: (id: string) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ userId?: string; teamId?: string; id: string }>).detail

    if (detail.userId === userId && detail.teamId === teamId) onCreated(detail.id)
  }

  window.addEventListener(CREATED_EVENT, handler)

  return () => window.removeEventListener(CREATED_EVENT, handler)
}
