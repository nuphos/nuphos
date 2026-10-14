import { api, parseAtlasError } from '../api.ts'

import { applyProjectChange, nextProjectName } from './sidebar-projects/model.ts'

import type { SidebarProject, SidebarProjectChange } from './sidebar-projects/model.ts'

export type { SidebarProject, SidebarProjectChange } from './sidebar-projects/model.ts'

const CACHE_STORAGE_KEY = 'nuphos.sidebarProjects.v1'
const CHANGE_EVENT = 'nuphos:sidebar-projects-changed'
const CREATED_EVENT = 'nuphos:sidebar-project-created'
const MAX_CONFLICT_RETRIES = 5

type ScopeState = {
  /** The list as the server last confirmed it. */
  confirmed: SidebarProject[]
  revision: number
  /** Local changes not yet saved, replayed on top of `confirmed`. */
  pending: SidebarProjectChange[]
  saving: Promise<void> | null
}

const states = new Map<string, ScopeState>()

function scopeKey(userId: string, teamId: string): string {
  return `${encodeURIComponent(userId)}|${encodeURIComponent(teamId)}`
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

function readCache(): Record<string, { projects?: unknown; revision?: unknown } | undefined> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY) ?? '{}') as unknown

    return parsed && typeof parsed === 'object' ? (parsed as never) : {}
  } catch {
    return {}
  }
}

function stateFor(userId: string, teamId: string): ScopeState {
  const key = scopeKey(userId, teamId)
  const existing = states.get(key)

  if (existing) return existing
  const cached = readCache()[key]
  const state: ScopeState = {
    confirmed: Array.isArray(cached?.projects) ? cached.projects.filter(validProject) : [],
    revision: typeof cached?.revision === 'number' ? cached.revision : 0,
    pending: [],
    saving: null,
  }

  states.set(key, state)

  return state
}

function confirm(userId: string, teamId: string, projects: SidebarProject[], revision: number) {
  const state = stateFor(userId, teamId)

  state.confirmed = projects.filter(validProject)
  state.revision = revision
  try {
    localStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify({ ...readCache(), [scopeKey(userId, teamId)]: { projects, revision } }),
    )
  } catch {
    // The in-memory copy still serves this session.
  }
}

function notify(userId: string, teamId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userId, teamId } }))
}

/** This person's projects in this team, including changes still being saved. */
export function readSidebarProjects(userId: string, teamId: string): SidebarProject[] {
  const state = stateFor(userId, teamId)

  return state.pending.reduce(applyProjectChange, state.confirmed)
}

async function saveOnce(userId: string, teamId: string): Promise<void> {
  const state = stateFor(userId, teamId)

  let conflicts = 0

  // Changes made while a save is in flight go out in the next round.
  while (state.pending.length > 0) {
    const captured = state.pending.length
    const desired = state.pending.slice(0, captured).reduce(applyProjectChange, state.confirmed)

    try {
      const saved = await api.atlasPutSidebarProjects(teamId, desired, state.revision)

      confirm(userId, teamId, saved.projects, saved.revision)
      state.pending.splice(0, captured)
      notify(userId, teamId)
      conflicts = 0
    } catch (error) {
      if (parseAtlasError(error).code !== 'sidebar_projects_changed') throw error
      conflicts += 1
      if (conflicts >= MAX_CONFLICT_RETRIES)
        throw new Error('Projects kept changing concurrently', { cause: error })
      // Someone saved first (another window or device): replay onto theirs.
      const remote = await api.atlasGetSidebarProjects(teamId)

      confirm(userId, teamId, remote.projects, remote.revision)
    }
  }
}

/**
 * Applies a change locally right away and saves it. On failure the change is
 * dropped, so the sidebar falls back to the saved list, and the caller is told.
 */
export function updateSidebarProjects(
  userId: string,
  teamId: string,
  change: SidebarProjectChange,
): Promise<void> {
  const state = stateFor(userId, teamId)

  state.pending.push(change)
  notify(userId, teamId)
  const previous = state.saving ?? Promise.resolve()
  const run = previous
    .catch(() => {
      // The earlier change reported its own failure.
    })
    .then(() => saveOnce(userId, teamId))
    .catch((error: unknown) => {
      state.pending = []
      notify(userId, teamId)
      throw error
    })
    .finally(() => {
      if (state.saving === run) state.saving = null
    })

  state.saving = run

  return run
}

/** Refreshes from the server unless local changes are still being saved. */
export async function syncSidebarProjects(userId: string, teamId: string): Promise<void> {
  if (!userId || !teamId) return
  const remote = await api.atlasGetSidebarProjects(teamId)
  const state = stateFor(userId, teamId)

  if (state.saving || state.pending.length > 0) return
  confirm(userId, teamId, remote.projects, remote.revision)
  notify(userId, teamId)
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
export function createSidebarProject(
  userId: string,
  teamId: string,
  sessionId?: string,
): { id: string; saved: Promise<void> } {
  const id = globalThis.crypto.randomUUID()
  const name = nextProjectName(readSidebarProjects(userId, teamId))
  const saved = updateSidebarProjects(userId, teamId, { kind: 'create', id, name, sessionId })

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CREATED_EVENT, { detail: { userId, teamId, id } }))
  }

  return { id, saved }
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
