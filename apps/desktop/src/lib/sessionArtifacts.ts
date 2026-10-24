// The artifacts each conversation on screen holds, read off its messages by the
// chat, so its dock tab can show one without loading the transcript again.
// Like the session desktops, nothing is persisted: the transcript is the source,
// and a chat that leaves the screen is forgotten.
//
// Versions are named by number, never by tool call id: a live call's id is the
// one the Nuphos tool made up, and the stored turn that replaces it at the end
// of the turn carries the runtime's id for the same call.

import type { ArtifactVersion } from '../components/agent/artifacts/artifactPayload'

type Lines = ReadonlyMap<string, readonly ArtifactVersion[]>
type CallRef = { sessionId: string; artifactId: string }

export const ARTIFACT_PAGE = 'team.artifact'

const bySession = new Map<string, Lines>()
/** The chat views publishing each session; it is forgotten when the last one goes. */
const owners = new Map<string, Set<symbol>>()
const byCall = new Map<string, CallRef>()
/** The version number a viewer picked, per artifact; none means the latest. */
const picked = new Map<string, number>()
const listeners = new Set<() => void>()

const pickKey = (sessionId: string, artifactId: string) => `${sessionId}\u0000${artifactId}`
const notify = () => {
  for (const listener of listeners) listener()
}

function lineSignature(line: readonly ArtifactVersion[]): string {
  return line.map((version) => `${version.toolCallId}:${String(version.content.length)}`).join(',')
}

function unindex(sessionId: string, lines: Lines | undefined) {
  for (const line of lines?.values() ?? []) {
    for (const { toolCallId } of line) {
      if (byCall.get(toolCallId)?.sessionId === sessionId) byCall.delete(toolCallId)
    }
  }
}

function index(sessionId: string, lines: Lines) {
  for (const [artifactId, line] of lines) {
    for (const { toolCallId } of line) byCall.set(toolCallId, { sessionId, artifactId })
  }
}

/**
 * Publish what `owner` (one mounted chat view) reads off a session. A line
 * that did not change keeps its array, so views reading it do not re-render on
 * every streamed token.
 */
export function publishSessionArtifacts(
  owner: symbol,
  sessionId: string,
  lines: ReadonlyMap<string, ArtifactVersion[]>,
): void {
  const holders = owners.get(sessionId) ?? new Set<symbol>()

  holders.add(owner)
  owners.set(sessionId, holders)
  const before = bySession.get(sessionId)

  if (!before && lines.size === 0) return
  let changed = before?.size !== lines.size
  const next = new Map<string, readonly ArtifactVersion[]>()

  for (const [artifactId, line] of lines) {
    const previous = before?.get(artifactId)

    if (previous && lineSignature(previous) === lineSignature(line)) {
      next.set(artifactId, previous)
      continue
    }
    changed = true
    next.set(artifactId, line)
    // A new version follows the agent: whoever had an older one open sees it.
    if (previous && line.length > previous.length) picked.delete(pickKey(sessionId, artifactId))
  }
  if (!changed) return
  unindex(sessionId, before)
  index(sessionId, next)
  bySession.set(sessionId, next)
  notify()
}

/** `owner`'s view left the screen; the session is forgotten once no view holds it. */
export function releaseSessionArtifacts(owner: symbol, sessionId: string): void {
  const holders = owners.get(sessionId)

  if (!holders?.delete(owner) || holders.size > 0) return
  owners.delete(sessionId)
  const before = bySession.get(sessionId)

  if (!before) return
  unindex(sessionId, before)
  bySession.delete(sessionId)
  notify()
}

export function subscribeSessionArtifacts(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function readArtifactLine(
  sessionId: string | null | undefined,
  artifactId: string,
): readonly ArtifactVersion[] | undefined {
  return sessionId ? bySession.get(sessionId)?.get(artifactId) : undefined
}

/** Which session and artifact a `render_artifact` call belongs to, while its chat is on screen. */
export function readArtifactCall(toolCallId: string): CallRef | undefined {
  return byCall.get(toolCallId)
}

export function readPickedArtifactVersion(
  sessionId: string | null | undefined,
  artifactId: string,
): number | undefined {
  return sessionId ? picked.get(pickKey(sessionId, artifactId)) : undefined
}

/** Show `version` in the artifact's tab; `null` goes back to following the latest. */
export function pickArtifactVersion(
  sessionId: string,
  artifactId: string,
  version: number | null,
): void {
  const key = pickKey(sessionId, artifactId)

  if ((picked.get(key) ?? null) === version) return
  if (version === null) picked.delete(key)
  else picked.set(key, version)
  notify()
}

/** The app path of an artifact's dock tab. One tab per artifact: the version is picked, not routed. */
export function artifactPagePath(teamId: string, artifactId: string): string {
  return `/teams/${encodeURIComponent(teamId)}/artifacts/${encodeURIComponent(artifactId)}`
}

/**
 * Artifacts a link asked to open, by session: the version it pins, or null for
 * the latest. A request waits until that session's chat is on screen and holds
 * the artifact. The chat appears only for someone who can read the
 * conversation, so for anyone else the request simply never fires.
 */
const requested = new Map<string, Map<string, number | null>>()

export function requestArtifactOpen(sessionId: string, artifactId: string, version?: number): void {
  const forSession = requested.get(sessionId) ?? new Map<string, number | null>()

  forSession.set(artifactId, version ?? null)
  requested.set(sessionId, forSession)
  notify()
}

/**
 * The first requested artifact this session's chat now holds, removed from
 * the queue. A pinned version the line does not have opens the latest.
 */
export function takeRequestedArtifact(
  sessionId: string,
): { artifactId: string; version: number | null } | null {
  const forSession = requested.get(sessionId)
  const lines = bySession.get(sessionId)

  if (!forSession || !lines) return null
  for (const [artifactId, version] of forSession) {
    const line = lines.get(artifactId)

    if (!line?.length) continue
    forSession.delete(artifactId)
    if (forSession.size === 0) requested.delete(sessionId)

    return {
      artifactId,
      version: version !== null && line.some((entry) => entry.version === version) ? version : null,
    }
  }

  return null
}
