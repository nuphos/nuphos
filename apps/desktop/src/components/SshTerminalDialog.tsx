import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useCallback, useEffect, useRef } from 'react'

import { api } from '../api'
import { useTheme } from '../hooks/useTheme'
import { trackError } from '../lib/analytics'

import { Modal } from './Modal'
import { xtermThemeFor } from './terminalTheme'

type Props = {
  sessionId: string
  title: string
  onClose: () => void
}

export function SshTerminalDialog({ sessionId, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const closeRequestedRef = useRef(false)
  const { resolved } = useTheme()

  const handleClose = useCallback(() => {
    if (!closeRequestedRef.current) {
      closeRequestedRef.current = true
      void api.sshTerminalClose(sessionId)
    }
    onClose()
  }, [onClose, sessionId])

  useEffect(() => {
    const container = containerRef.current

    if (!container) return

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
    terminal.writeln('Connecting…')

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
    // Theme is applied imperatively below; don't rebuild the terminal on
    // theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    const terminal = terminalRef.current

    if (terminal) terminal.options.theme = xtermThemeFor(resolved)
  }, [resolved])

  return (
    <Modal open title={title} onClose={handleClose} width={980}>
      <div className="p-3">
        <div
          ref={containerRef}
          className={`h-[560px] overflow-hidden rounded-lg border border-zGray-800 ${
            resolved === 'light' ? 'bg-white' : 'bg-[#0f0e11]'
          } p-2`}
        />
      </div>
    </Modal>
  )
}
