import { PassThrough } from 'node:stream'

import * as k8s from '@kubernetes/client-node'

import { keyParts, rememberTabScope, tabScopeAllows } from './session-keys.ts'
import { exitCodeFromStatus, RendererTtyStream } from './tty.ts'

import type { WebContents } from 'electron'

export type PodExecEvent =
  | { id: string; type: 'data'; data: string }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'exit'; code: number | null; reason: string | null }

export type PodExecSession = {
  id: string
  stdin: PassThrough
  stdout: RendererTtyStream
  ws: { close: () => void } | null
  events: PodExecEvent[]
  closed: boolean
  exited: boolean
  // Live-streaming runs only while a view is attached. Events are always
  // buffered; replay flushes the buffer and turns streaming back on, so output
  // is never both live-delivered and replayed (which duplicated the prompt).
  // Detaching on unmount is what makes that hold a second time around: the
  // session outlives the view, so attach/detach happens more than once.
  attached: boolean
  // Runs once on teardown. Node-shell sessions use it to delete the ephemeral
  // privileged pod they created, so closing the terminal never leaks one.
  onCleanup?: () => void
}

/** Live sessions, keyed by the id the renderer supplies — see session-keys.ts. */
const sessions = new Map<string, PodExecSession>()

export function deleteSession(id: string): void {
  sessions.delete(id)
}

/** A session that is still usable — a closed one is kept only for its buffer. */
export function liveSession(id: string): PodExecSession | null {
  const session = sessions.get(id)

  return session && !session.closed ? session : null
}

export function send(target: WebContents, session: PodExecSession, payload: PodExecEvent): void {
  session.events.push(payload)
  // Bounded buffer so a slow/late attach can still repaint recent output
  // without unbounded memory growth.
  if (session.events.length > 400) session.events.shift()
  if (session.attached && !target.isDestroyed()) target.send('pod-exec:event', payload)
}

function emitExit(
  target: WebContents,
  session: PodExecSession,
  code: number | null,
  reason: string | null,
): void {
  if (session.exited) return
  session.exited = true
  send(target, session, { id: session.id, type: 'exit', code, reason })
}

function expireSession(id: string): void {
  setTimeout(() => sessions.delete(id), 5 * 60_000).unref()
}

function cleanup(id: string): void {
  const session = sessions.get(id)

  if (!session || session.closed) return
  session.closed = true
  try {
    session.stdin.end()
  } catch {
    // best-effort
  }
  // Fire the teardown hook exactly once (guarded by the closed flag above) —
  // e.g. delete the node-shell pod. Best-effort: never let it throw out of
  // cleanup, which runs from ws close/error handlers.
  if (session.onCleanup) {
    const hook = session.onCleanup

    session.onCleanup = undefined
    try {
      hook()
    } catch {
      // best-effort
    }
  }
  expireSession(id)
}

// Build + register a session with its stdin/stdout wired to the renderer.
export function createSession(
  target: WebContents,
  id: string,
  opts?: { cols?: number; rows?: number },
): PodExecSession {
  if (!id || id.length > 400) throw new Error('Invalid terminal session id.')
  if (!tabScopeAllows(id)) {
    throw new Error('This terminal was closed while it was still opening.')
  }
  const stdin = new PassThrough()
  const stdout = new RendererTtyStream(
    (data) => {
      const session = sessions.get(id)

      if (session) send(target, session, { id, type: 'data', data })
    },
    opts?.cols ?? 80,
    opts?.rows ?? 24,
  )
  const session: PodExecSession = {
    id,
    stdin,
    stdout,
    ws: null,
    events: [],
    closed: false,
    exited: false,
    attached: false,
  }

  sessions.set(id, session)

  return session
}

// Open the exec WebSocket into (namespace/pod/container) running `command` and
// wire its lifecycle to the session. Shared by pod exec and node-shell exec.
export async function attachExec(
  target: WebContents,
  kc: k8s.KubeConfig,
  session: PodExecSession,
  namespace: string,
  pod: string,
  container: string,
  command: string[],
): Promise<void> {
  const exec = new k8s.Exec(kc)
  const ws = await exec.exec(
    namespace,
    pod,
    container,
    command,
    session.stdout,
    // stderr MUST be null with tty: the API server rejects a request that
    // asks for a separate stderr stream alongside a tty (they're merged).
    null,
    session.stdin,
    true,
    (status) =>
      emitExit(
        target,
        session,
        exitCodeFromStatus(status),
        status.status === 'Failure' ? (status.message ?? null) : null,
      ),
  )
  const socket = ws as unknown as { close: () => void }

  // The session is registered before exec.exec() resolves, so teardown can
  // race in during the await. If it did, close this just-opened socket
  // immediately instead of attaching it — otherwise it leaks a live remote
  // exec past teardown.
  if (session.closed) {
    try {
      socket.close()
    } catch {
      // best-effort
    }

    return
  }
  session.ws = socket
  ws.on('close', () => {
    emitExit(target, session, null, null)
    cleanup(session.id)
  })
  ws.on('error', (err: Error) => {
    // A socket error is terminal — surface it and tear down so input becomes
    // a no-op and the session doesn't linger writable.
    send(target, session, { id: session.id, type: 'error', message: err.message })
    emitExit(target, session, null, null)
    cleanup(session.id)
  })
}

export function writePodExecSession(id: string, data: string): void {
  const session = sessions.get(id)

  if (!session || session.closed) return
  session.stdin.write(data)
}

export function resizePodExecSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)

  if (!session || session.closed) return
  session.stdout.setSize(cols, rows)
}

// Renderer attach point: flush everything buffered so far, then switch the
// session to live streaming. Runs synchronously (no await), so no ws 'data'
// callback can interleave and slip an event past the flush.
export function replayPodExecSession(target: WebContents, id: string): void {
  const session = sessions.get(id)

  if (!session) return
  session.attached = true
  for (const event of session.events.slice()) {
    if (!target.isDestroyed()) target.send('pod-exec:event', event)
  }
}

export function closePodExecSession(id: string): void {
  const session = sessions.get(id)

  if (!session) return
  try {
    session.ws?.close()
  } catch {
    // best-effort
  }
  cleanup(id)
  // Explicit teardown (pod switch / detail close) — drop it now rather than
  // holding the websocket ref + buffer until the idle expiry.
  sessions.delete(id)
}

/** The view went away (unmounted) but the session lives on — stop streaming to
 *  a listener that is no longer there and let the buffer take over. */
export function detachPodExecSession(id: string): void {
  const session = sessions.get(id)

  if (session) session.attached = false
}

/**
 * End every session the given tab owns except those in `scope` — the pod or
 * node that tab currently has open. `null` closes all of them, which is what a
 * closed tab, or one that navigated off the detail page, means.
 *
 * This is the whole teardown rule: a session is wanted for exactly as long as
 * its tab is still looking at its target. Unmounting is not part of it, because
 * switching chat session unmounts every pane of the session you left.
 */
export function closeSessionsOutsideScope(tabId: string, scope: string | null): void {
  rememberTabScope(tabId, scope)
  for (const id of sessions.keys()) {
    const parts = keyParts(id)

    if (parts.tabId !== tabId) continue
    if (scope !== null && parts.scope === scope) continue
    closePodExecSession(id)
  }
}

export function closeAllPodExecSessions(): void {
  for (const id of sessions.keys()) closePodExecSession(id)
}
