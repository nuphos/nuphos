import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Loader2, Terminal } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { api } from '../api'
import { useTheme } from '../hooks/useTheme'
import { trackError } from '../lib/analytics'

import { xtermThemeFor } from './terminalTheme'

type Props = {
  sessionId: string | null
  title: string
  subtitle: string
  status: 'connecting' | 'connected' | 'error'
  error: string | null
}

export function SshTerminalView({ sessionId, title, subtitle, status, error }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const { resolved } = useTheme()

  useEffect(() => {
    const container = containerRef.current

    if (!container || !sessionId) return

    const fitAddon = new FitAddon()
    const terminal = new XtermTerminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: xtermThemeFor(resolved),
    })

    terminalRef.current = terminal

    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()
    terminal.focus()

    const dataDisposable = terminal.onData((data) => {
      void api.sshTerminalInput(sessionId, data)
    })
    const unsubscribe = api.onSshTerminalEvent((event) => {
      if (event.id !== sessionId) return
      if (event.type === 'data') {
        terminal.write(event.data)
      } else if (event.type === 'error') {
        trackError({
          source: 'ssh_terminal',
          phase: 'session_error_event',
          message: event.message,
          sessionId,
        })
        terminal.writeln(`\r\nConnection error: ${event.message}`)
      } else {
        const detail = event.signal ? `signal ${event.signal}` : `code ${String(event.code ?? 0)}`

        if (event.signal || (event.code ?? 0) !== 0) {
          trackError({
            source: 'ssh_terminal',
            phase: 'unexpected_close',
            message: `SSH connection closed with ${detail}.`,
            sessionId,
          })
        }

        terminal.writeln(`\r\nConnection closed (${detail}).`)
      }
    })

    void api.sshTerminalReplay(sessionId)

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })

    resizeObserver.observe(container)

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
    }
    // Theme is applied imperatively in a separate effect so theme changes
    // don't recreate the xterm instance (which would lose scrollback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    const terminal = terminalRef.current

    if (terminal) terminal.options.theme = xtermThemeFor(resolved)
  }, [resolved])

  const terminalSurface = resolved === 'light' ? 'bg-white' : 'bg-[#0f0e11]'

  const statusBadge =
    status === 'connected' ? null : (
      <div
        className={`mb-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] ${
          status === 'error'
            ? 'border-error/40 bg-error/10 text-error'
            : 'border-zViolet-accent/40 bg-zViolet-accent/10 text-zViolet-accent'
        }`}
      >
        {status === 'connecting' ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <Terminal className="w-3.5 h-3.5" strokeWidth={1.8} />
        )}
        {status === 'error'
          ? `Failed: ${error || 'Unable to open SSH session.'}`
          : `Connecting to ${title}…`}
        <span className="sr-only">{subtitle}</span>
      </div>
    )

  return (
    <div className={`h-full min-h-0 flex flex-col ${terminalSurface}`}>
      <div className="flex-1 min-h-0 flex flex-col">
        {statusBadge && <div className="px-5 pt-4">{statusBadge}</div>}
        {status === 'error' ? (
          <div
            className={`flex-1 min-h-[360px] ${terminalSurface} px-5 py-4 font-mono text-[13px] leading-6 text-error whitespace-pre-wrap`}
          >
            {error || 'Unable to open SSH session.'}
          </div>
        ) : sessionId ? (
          <div
            ref={containerRef}
            className={`flex-1 min-h-[360px] overflow-hidden ${terminalSurface} px-5 py-4`}
          />
        ) : (
          <div
            className={`flex-1 min-h-[360px] ${terminalSurface} px-5 py-4 font-mono text-[13px] leading-6 text-secondary`}
          >
            Connecting…
          </div>
        )}
      </div>
    </div>
  )
}
