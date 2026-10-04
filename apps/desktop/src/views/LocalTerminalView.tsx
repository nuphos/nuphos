import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { RotateCw, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { PageMeta } from '../app/pageMeta'
import { xtermThemeFor } from '../components/terminalTheme'
import { toast } from '../components/ui/toast'
import { useTheme } from '../hooks/useTheme'
import { useWorkspaceTab } from '../hooks/useWorkspaceTab'

import type { TerminalTarget } from '../api/local-terminal-types'

export function LocalTerminalView({ target }: { target?: TerminalTarget }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XtermTerminal | null>(null)
  const { resolved } = useTheme()
  const themeRef = useRef(resolved)
  const { tabId, isActive } = useWorkspaceTab()
  const [generation, setGeneration] = useState(0)
  const [status, setStatus] = useState(target ? 'Connecting to runtime…' : 'Starting local shell…')
  const [closed, setClosed] = useState(false)
  // End the dead shell before asking for a new one — `start` is keyed by tab id
  // and would otherwise hand back the same one. A rejection means it is already
  // gone, which is the state this wanted anyway.
  const nextGeneration = () => setGeneration((value) => value + 1)
  const newShell = () => {
    void api.localTerminalClose(tabId).then(nextGeneration, nextGeneration)
  }

  useEffect(() => {
    themeRef.current = resolved
    if (terminalRef.current) terminalRef.current.options.theme = xtermThemeFor(resolved)
  }, [resolved])

  // The shell belongs to the tab, not to this view: switching chat sessions
  // unmounts the pane, and the user expects the same shell (and its scrollback)
  // when they come back. So the PTY is keyed by tab id in the main process and
  // survives the unmount — `start` reattaches to it, and only closing the tab
  // ends it (see the teardown observer in useWorkspaceTabSync).
  useEffect(() => {
    const host = hostRef.current

    if (!host || !tabId) return
    let disposed = false
    let started = false
    let ended = false
    const fit = new FitAddon()
    const terminal = new XtermTerminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: xtermThemeFor(themeRef.current),
    })

    terminalRef.current = terminal
    terminal.loadAddon(fit)
    terminal.open(host)
    const reportError = (error: unknown) => {
      if (disposed) return
      const message = error instanceof Error ? error.message : String(error)

      ended = true
      setClosed(true)
      setStatus('Terminal unavailable')
      terminal.writeln(`\r\n${message}`)
    }
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight || disposed) return
      fit.fit()
      if (started && !ended)
        void api.localTerminalResize(tabId, terminal.cols, terminal.rows).catch(reportError)
    }
    const input = terminal.onData((data) => {
      if (!started || ended) return
      if (target && new TextEncoder().encode(data).length > 16384) {
        toast.error('Terminal input is too large', 'Paste at most 16 KiB at a time.')

        return
      }
      void api.localTerminalInput(tabId, data).catch((error: unknown) => {
        if (!disposed) toast.apiError('Could not send terminal input', error)
      })
    })
    const observer = new ResizeObserver(resize)
    let offEvent: (() => void) | undefined

    observer.observe(host)
    resize()
    setClosed(false)
    setStatus(target ? 'Connecting to runtime…' : 'Starting local shell…')
    api
      .localTerminalStart(tabId, terminal.cols, terminal.rows, target)
      .then(async ({ shell }) => {
        if (disposed) return
        started = true
        setStatus(shell.split(/[\\/]/).at(-1) ?? shell)
        // Only `data` is this view's business: an `exit` closes the whole tab
        // (see useWorkspaceTabSync), so there is no exited state left to render.
        offEvent = api.onLocalTerminalEvent((event) => {
          if (event.id !== tabId || disposed) return
          if (event.type === 'data') terminal.write(event.data)
        })
        // Subscribe first, then replay: the buffer covers everything emitted
        // before the listener existed, including this shell's first prompt.
        await api.localTerminalReplay(tabId)
        resize()
        if (host.getClientRects().length > 0) terminal.focus()
      })
      .catch(reportError)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      offEvent?.()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [tabId, generation, target])

  useEffect(() => {
    if (!isActive) return
    const frame = window.requestAnimationFrame(() => terminalRef.current?.focus())

    return () => window.cancelAnimationFrame(frame)
  }, [isActive])

  return (
    <PageMeta
      pageKey="team.terminal"
      title={target ? 'Runtime terminal' : 'Local terminal'}
      icon={<Terminal className="h-3.5 w-3.5" />}
    >
      <div
        className={`flex h-full min-h-0 flex-col ${resolved === 'light' ? 'bg-white' : 'bg-[#0f0e11]'}`}
      >
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zGray-800/60 px-3 text-xs text-tertiary">
          <Terminal className="h-3.5 w-3.5" />
          <span>{target ? 'Runtime terminal' : 'Local terminal'}</span>
          <span className="ml-auto" role="status">
            {status}
          </span>
          {closed && (
            <button
              type="button"
              onClick={newShell}
              className="flex items-center gap-1 rounded px-2 py-1 text-secondary hover:bg-zGray-800/60"
              aria-label="New shell"
            >
              <RotateCw className="h-3 w-3" /> New shell
            </button>
          )}
        </div>
        <div
          ref={hostRef}
          className="min-h-0 flex-1 overflow-hidden p-3"
          aria-label={target ? 'Runtime terminal' : 'Local terminal'}
        />
      </div>
    </PageMeta>
  )
}
