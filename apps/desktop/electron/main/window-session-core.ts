// Pure halves of window-session.ts: the on-disk shape, its validation and
// fitting saved bounds onto whatever displays exist now. No Electron imports,
// so the rules are testable on their own.

import fs from 'node:fs'
import path from 'node:path'

export type Rect = { x: number; y: number; width: number; height: number }

/** What a window's main pane showed. Tabs are restored separately, per session. */
export type WindowSurface = {
  sessionId: string | null
  readOnly: boolean
  teamId: string | null
  mainPageOpen: boolean
}

/** `account` is who `surface` belongs to; another account restores only the bounds. */
export type SavedWindow = {
  bounds: Rect
  maximized: boolean
  fullScreen: boolean
  account: string | null
  surface: WindowSurface | null
}

export type WindowSession = { version: 1; windows: SavedWindow[] }

export const DEFAULT_WINDOW_SIZE = { width: 1400, height: 880 }
export const MIN_WINDOW_SIZE = { width: 900, height: 600 }
export const MAX_SAVED_WINDOWS = 12

const ID_PATTERN = /^[\w-]{1,128}$/
// Enough of the titlebar on screen to grab and drag the window back.
const MIN_VISIBLE = { width: 120, height: 40 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseId(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null
}

function parseRect(value: unknown): Rect | null {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value

  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const rect = { x, y, width, height } as Rect

  return rect.width > 0 && rect.height > 0 ? rect : null
}

export function parseWindowSurface(value: unknown): WindowSurface | null {
  if (!isRecord(value)) return null

  return {
    sessionId: parseId(value.sessionId),
    readOnly: value.readOnly === true,
    teamId: parseId(value.teamId),
    mainPageOpen: value.mainPageOpen === true,
  }
}

function parseSavedWindow(value: unknown): SavedWindow | null {
  if (!isRecord(value)) return null
  const bounds = parseRect(value.bounds)

  if (!bounds) return null

  return {
    bounds,
    maximized: value.maximized === true,
    fullScreen: value.fullScreen === true,
    account: typeof value.account === 'string' ? value.account : null,
    surface: parseWindowSurface(value.surface),
  }
}

/** Anything unreadable becomes an empty session, so a bad file never blocks startup. */
export function parseWindowSession(value: unknown): WindowSession {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.windows)) {
    return { version: 1, windows: [] }
  }
  const windows = value.windows
    .map(parseSavedWindow)
    .filter((window): window is SavedWindow => window !== null)
    .slice(0, MAX_SAVED_WINDOWS)

  return { version: 1, windows }
}

export function readWindowSession(file: string): WindowSession {
  try {
    return parseWindowSession(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return parseWindowSession(null)
  }
}

/** Written beside and renamed over, so a crash mid-write leaves the previous file whole. */
export function writeWindowSession(file: string, session: WindowSession): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(session))
    fs.renameSync(`${file}.tmp`, file)
  } catch (error) {
    console.warn('[window-session]', error)
  }
}

/** The saved surface, only for the account that saved it. */
export function restorableSurface(
  saved: Pick<SavedWindow, 'account' | 'surface'>,
  account: string | null,
): WindowSurface | null {
  return account !== null && saved.account === account ? saved.surface : null
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

function clampSize(size: { width: number; height: number }, area: Rect) {
  return {
    width: Math.max(Math.min(size.width, area.width), Math.min(MIN_WINDOW_SIZE.width, area.width)),
    height: Math.max(
      Math.min(size.height, area.height),
      Math.min(MIN_WINDOW_SIZE.height, area.height),
    ),
  }
}

/**
 * Keeps saved bounds while enough of the window lands on a display that still
 * exists; otherwise only the size survives, shrunk to the primary display, and
 * the OS centres it. A disconnected monitor never strands a window off screen.
 */
export function fitBoundsToDisplays(
  bounds: Rect,
  workAreas: readonly Rect[],
  primary: Rect,
): Partial<Rect> & { width: number; height: number } {
  const host = workAreas.find((area) => {
    const visible = overlap(bounds, area)

    return visible.width >= MIN_VISIBLE.width && visible.height >= MIN_VISIBLE.height
  })

  if (!host) return clampSize(bounds, primary)
  const size = clampSize(bounds, host)
  // The titlebar must stay below the work area's top edge (menu bar, notch).
  const y = Math.min(Math.max(bounds.y, host.y), host.y + host.height - MIN_VISIBLE.height)

  return { x: bounds.x, y, ...size }
}

export function accountKeyOf(api: string, userId: string | null): string | null {
  return userId ? `${api}#${userId}` : null
}
