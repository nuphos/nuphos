import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { api } from '../api'
import { useRequiredKubeContext } from '../hooks/useKubeContext'
import { useTheme } from '../hooks/useTheme'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'
import { trackError } from '../lib/analytics'
import { execScope, execSessionKey } from '../lib/terminalTabTeardown'

import { xtermThemeFor } from './terminalTheme'
import { toast } from './ui/toast'

type StartFn = (opts: { cols: number; rows: number }) => Promise<{ id: string }>

type ExecTerminalProps = {
  // Opens (or reattaches to) the session named by `sessionKey` and returns its
  // id. Input/resize/replay/close all share the pod-exec IPC channel (the
  // session id lives in one map), so only the start step differs between pod
  // exec and node shell.
  start: StartFn
  // Shown while connecting ("Connecting to {label}…").
  label: string
  // The session's identity in the main process: `execSessionKey(tabId, scope,
  // container)`. Changing it switches to a different session; it deliberately
  // does NOT change when the view unmounts, which is how a terminal survives a
  // chat-session switch.
  sessionKey: string
}

/**
 * Generic interactive exec terminal. Wires xterm input/output to a backend
 * session opened by `start`, forwards resizes, and replays buffered output on
 * attach. Used by both pod exec and node-shell terminals.
 */
export function ExecTerminalView({ start, label, sessionKey }: ExecTerminalProps) {
  const { resolved } = useTheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  // Keep the latest start fn without making it an effect dependency (callers
  // often pass a fresh closure each render); the session only changes with
  // `sessionKey`.
  const startRef = useRef(start)

  useLayoutEffect(() => {
    startRef.current = start
  }, [start])
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>(
    'connecting',
  )

  useEffect(() => {
    const host = containerRef.current

    if (!host) return
    let disposed = false
    let started = false
    let offEvent: (() => void) | null = null

    const fitAddon = new FitAddon()
    const terminal = new XtermTerminal({
      cursorBlink: true,
      // The pty already emits CRLF; don't translate again.
      convertEol: false,
      fontFamily:
        'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: xtermThemeFor(resolved),
    })

    terminalRef.current = terminal
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()
    terminal.focus()
    setStatus('connecting')

    const dataDisposable = terminal.onData((data) => {
      if (started) void api.podExecInput(sessionKey, data)
    })

    // Defer the start to a macrotask and cancel it on cleanup. Under React
    // StrictMode (and any quick remount) the effect runs mount→cleanup→mount
    // synchronously; deferring means the throwaway first mount's start is
    // cleared before it ever reaches `node-exec:start`, so the privileged-pod
    // consent dialog fires exactly once for the surviving terminal instead of
    // stacking two. start() itself stays a single dangerous op per consent.
    const startTimer = window.setTimeout(() => {
      startRef
        .current({ cols: terminal.cols, rows: terminal.rows })
        .then(({ id }) => {
          if (disposed) return
          started = true
          setStatus('connected')
          offEvent = api.onPodExecEvent((event) => {
            if (event.id !== id) return
            if (event.type === 'data') {
              terminal.write(event.data)
            } else if (event.type === 'error') {
              trackError({
                source: 'pod_terminal',
                phase: 'session_error_event',
                message: event.message,
                sessionId: id,
              })
              terminal.writeln(`\r\n\x1b[31mError: ${event.message}\x1b[0m`)
              setStatus('error')
            } else {
              // 127 = the shell binary wasn't found — for a pod, almost always a
              // distroless / minimal image; for a node shell, nsenter or the host
              // shell couldn't be started. Keep the message neutral either way.
              const detail =
                event.code === 127
                  ? 'shell not found (exit code 127) — distroless/minimal image or no shell available'
                  : event.reason
                    ? event.reason
                    : event.code != null
                      ? `exit code ${String(event.code)}`
                      : 'session ended'

              if (event.reason || (event.code ?? 0) !== 0) {
                trackError({
                  source: 'pod_terminal',
                  phase: 'unexpected_close',
                  message: `Terminal session closed: ${detail}.`,
                  sessionId: id,
                })
              }

              terminal.writeln(`\r\n\x1b[90m[${detail}]\x1b[0m`)
              setStatus('closed')
            }
          })
          void api.podExecReplay(id)
        })
        .catch((e: unknown) => {
          if (disposed) return
          const message = e instanceof Error ? e.message : String(e)

          setStatus('error')
          terminal.writeln(`\r\n\x1b[31mFailed to open terminal: ${message}\x1b[0m`)
          toast.apiError('Could not open terminal', e)
        })
    }, 0)

    const resizeObserver = new ResizeObserver(() => {
      // The host is kept mounted but hidden (display:none) on other tabs, which
      // reports 0x0 — don't fit to that, or we'd push a bogus 0x0 size to the
      // remote tty. Refit happens when the tab is shown again.
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      fitAddon.fit()
      if (started) void api.podExecResize(sessionKey, terminal.cols, terminal.rows)
    })

    resizeObserver.observe(host)

    // Unmounting is not closing. Switching chat session swaps the whole dock,
    // so this runs routinely while the user still wants the shell — detach so
    // the session buffers instead of streaming into a dead listener, and leave
    // the teardown decision to the tab-list observer in useWorkspaceTabSync.
    return () => {
      disposed = true
      window.clearTimeout(startTimer)
      offEvent?.()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      if (started) void api.podExecDetach(sessionKey)
      terminal.dispose()
      terminalRef.current = null
    }
    // Theme is applied imperatively below so theme changes don't recreate the
    // xterm instance (which would drop the session + scrollback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  useEffect(() => {
    const terminal = terminalRef.current

    if (terminal) terminal.options.theme = xtermThemeFor(resolved)
  }, [resolved])

  const surface = resolved === 'light' ? 'bg-white' : 'bg-[#0f0e11]'

  return (
    <div className={`h-full min-h-0 flex flex-col ${surface}`}>
      {status === 'connecting' && (
        <div className="px-5 pt-3 flex items-center gap-1.5 text-[11.5px] text-tertiary">
          <FontAwesomeIcon icon={faSpinner} spin className="w-3 h-3" />
          Connecting to {label}…
        </div>
      )}
      <div
        ref={containerRef}
        className={`flex-1 min-h-[360px] overflow-hidden ${surface} px-5 py-3`}
      />
    </div>
  )
}

type Props = {
  namespace: string
  pod: string
  container: string
}

/**
 * Interactive exec terminal for a pod container. Mount one per container (key by
 * container) so switching containers switches session.
 */
export function PodTerminalView({ namespace, pod, container }: Props) {
  const context = useRequiredKubeContext()
  const { tabId } = useWorkspaceTab()
  const sessionKey = execSessionKey(tabId, execScope(context, 'Pod', namespace, pod), container)

  return (
    <ExecTerminalView
      label={container}
      sessionKey={sessionKey}
      start={(opts) => api.podExecStart(sessionKey, context, namespace, pod, container, opts)}
    />
  )
}
