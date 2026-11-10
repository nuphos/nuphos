import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'

/**
 * A session workspace is a directory Nuphos makes inside a workspace for one
 * conversation, named after that conversation and carrying a marker naming the same
 * one. Both have to agree before anything here is deleted: a hashed name can be a
 * coincidence, and a marker on its own can be copied.
 */
export const SESSION_WORKSPACE_MARKER = '.nuphos-workspace'
export const SESSION_WORKSPACE_NAME = /^[0-9a-f]{64}$/u
export const SESSION_WORKSPACE_MARKER_VERSION = 1
/**
 * A session workspace nothing has touched for this long counts as finished. This is
 * far longer than the seven days the runtime waits before sweeping a session home: a
 * home is CLI configuration, while a workspace can hold a build tree someone comes
 * back to weeks later.
 */
export const SESSION_WORKSPACE_IDLE_MS = 30 * 24 * 60 * 60 * 1000

/** A marker larger than this is not one of ours, and is not read into memory. */
const MARKER_MAX_BYTES = 4096

export type SessionWorkspaceEntry = {
  /** The entry's own name inside the workspace root. */
  name: string
  /** The entry's path, as it sits inside the root. */
  path: string
  /** Our own marker is in it, and names it. */
  marked: boolean
  /** Milliseconds since anything in it changed; null when that cannot be shown. */
  ageMs: number | null
  /** Anything inside that is not our marker, so it may hold someone's work. */
  holdsWork: boolean
  /** A live session is using it. */
  inUse: boolean
  /** A link or a junction, or a path that resolves out of the root. */
  escapesRoot: boolean
}

/** Why an entry was kept. Every one of them is a reason not to delete somebody's files. */
export type KeepReason =
  'escapes-root' | 'unmarked' | 'holds-work' | 'unknown-age' | 'too-recent' | 'in-use'

export type ReclaimDecision =
  | { name: string; path: string; delete: true; reason: 'stale-session-workspace' }
  | { name: string; path: string; delete: false; reason: KeepReason }

/**
 * Which of these entries may be deleted. Kept separate from the file system so the
 * decision can be tested on its own: it deletes user data, so every rule it applies is
 * here, in one order, and an entry that fails any of them is kept.
 */
export function planReclaim(entries: readonly SessionWorkspaceEntry[]): ReclaimDecision[] {
  return entries.map((entry): ReclaimDecision => {
    const keep = keepReason(entry)

    return keep === undefined
      ? { name: entry.name, path: entry.path, delete: true, reason: 'stale-session-workspace' }
      : { name: entry.name, path: entry.path, delete: false, reason: keep }
  })
}

function keepReason(entry: SessionWorkspaceEntry): KeepReason | undefined {
  if (entry.escapesRoot) return 'escapes-root'
  if (!entry.marked) return 'unmarked'
  if (entry.holdsWork) return 'holds-work'
  if (entry.ageMs === null) return 'unknown-age'
  if (entry.ageMs < SESSION_WORKSPACE_IDLE_MS) return 'too-recent'
  if (entry.inUse) return 'in-use'

  return undefined
}

/** The conversation's own directory name. Hashing keeps metadata out of a file path. */
export function sessionWorkspaceName(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex')
}

/**
 * Whether `child` is a direct entry of `root`, by resolved path. Decided by
 * `path.relative` rather than a string prefix, which is also what makes Windows
 * compare the two case-insensitively.
 */
export function insideRoot(root: string, child: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(child))

  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    !relative.includes(path.sep)
  )
}

export type ReclaimOptions = {
  /** Whether something is using this directory right now. Without it, nothing is deleted. */
  inUse?: (dir: string) => boolean | Promise<boolean>
  now?: () => number
  log?: (message: string, data?: Record<string, unknown>) => void
}

/**
 * Removes the session workspaces of `root` that are provably ours, provably finished
 * and provably unused. Everything else is kept, and every failure is logged and
 * swallowed: this runs beside a live app, where one unreadable directory must not
 * become a broken launch or an unhandled rejection.
 */
export async function reclaimSessionWorkspaces(
  root: string,
  options: ReclaimOptions = {},
): Promise<string[]> {
  const names = await readdir(root).catch(() => [])
  const now = options.now?.() ?? Date.now()
  const entries = await Promise.all(names.map((name) => entryOf(root, name, options, now)))
  const removed: string[] = []

  for (const decision of planReclaim(entries)) {
    if (!decision.delete) continue
    try {
      await removeEntry(root, decision.path)
      removed.push(decision.path)
    } catch (error) {
      options.log?.('local runtime: a session workspace was not reclaimed', {
        path: decision.path,
        error: String(error),
      })
    }
  }

  return removed
}

/** Deletes one entry, on a path resolved again: what is deleted is checked, not assumed. */
async function removeEntry(root: string, dir: string): Promise<void> {
  const [real, realRoot] = await Promise.all([
    realpath(dir).catch(() => null),
    realpath(root).catch(() => null),
  ])

  if (real === null || realRoot === null || !insideRoot(realRoot, real))
    throw new Error(`${dir} does not resolve inside the workspace root`)

  await rm(dir, { recursive: true, force: true })
}

async function entryOf(
  root: string,
  name: string,
  options: ReclaimOptions,
  now: number,
): Promise<SessionWorkspaceEntry> {
  const dir = path.join(root, name)
  const unmarked: SessionWorkspaceEntry = {
    name,
    path: dir,
    marked: false,
    ageMs: null,
    holdsWork: true,
    inUse: true,
    escapesRoot: false,
  }

  // An ordinary directory in someone's workspace costs one regular expression here,
  // and can never be more than kept.
  if (!SESSION_WORKSPACE_NAME.test(name)) return unmarked
  const { escapesRoot, marked } = await ownershipOf(root, dir, name)

  if (!marked) return { ...unmarked, escapesRoot }
  const contents = await contentsOf(dir, now)

  return {
    ...unmarked,
    marked,
    escapesRoot,
    ...contents,
    // Without a probe nothing can be shown to be idle, and what cannot be shown to be
    // idle is kept. Asked here, so the answer is not overwritten by what is inside.
    inUse: options.inUse === undefined ? true : await options.inUse(dir),
  }
}

/** Whether this directory is provably ours, and whether it resolves out of the root. */
async function ownershipOf(
  root: string,
  dir: string,
  name: string,
): Promise<{ escapesRoot: boolean; marked: boolean }> {
  const stat = await lstat(dir).catch(() => null)

  if (stat === null) return { escapesRoot: false, marked: false }
  // A link, a junction or a file is never a workspace of ours, and is never followed.
  if (stat.isSymbolicLink()) return { escapesRoot: true, marked: false }
  if (!stat.isDirectory()) return { escapesRoot: false, marked: false }
  const [real, realRoot] = await Promise.all([
    realpath(dir).catch(() => null),
    realpath(root).catch(() => null),
  ])

  // A junction in the path itself is only caught by resolving it.
  if (real === null || realRoot === null || !insideRoot(realRoot, real))
    return { escapesRoot: true, marked: false }

  return { escapesRoot: false, marked: await markedFor(dir, name) }
}

/** Whether the directory's own marker names it: our JSON, naming the name it sits in. */
async function markedFor(dir: string, name: string): Promise<boolean> {
  const stat = await lstat(path.join(dir, SESSION_WORKSPACE_MARKER)).catch(() => null)

  if (stat === null || !stat.isFile() || stat.size > MARKER_MAX_BYTES) return false
  const text = await readFile(path.join(dir, SESSION_WORKSPACE_MARKER), 'utf8').catch(() => null)

  if (text === null) return false
  try {
    const marker = JSON.parse(text) as { version?: unknown; sessionId?: unknown }

    return (
      marker.version === SESSION_WORKSPACE_MARKER_VERSION &&
      typeof marker.sessionId === 'string' &&
      marker.sessionId !== '' &&
      sessionWorkspaceName(marker.sessionId) === name
    )
  } catch {
    return false
  }
}

/**
 * What is inside and when it last changed. Anything but our own marker is something a
 * session or a person put there, so a directory holding it is kept: a workspace is a
 * directory they are shown in the file manager, not scratch space of ours.
 */
async function contentsOf(
  dir: string,
  now: number,
): Promise<{ ageMs: number | null; holdsWork: boolean }> {
  const names = await readdir(dir).catch(() => null)
  const kept = { ageMs: null, holdsWork: true }

  if (names === null) return kept
  if (names.some((name) => name !== SESSION_WORKSPACE_MARKER)) return kept
  const stats = await Promise.all(
    [dir, path.join(dir, SESSION_WORKSPACE_MARKER)].map((at) => lstat(at).catch(() => null)),
  )
  const newest = Math.max(...stats.map((stat) => stat?.mtimeMs ?? 0))

  return { ageMs: newest === 0 ? null : now - newest, holdsWork: false }
}
