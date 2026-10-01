import { AlertTriangle, Clipboard, RefreshCw } from 'lucide-react'
import { Component } from 'react'

import { captureRendererException } from '../lib/analytics'

import { NuphosLogo } from './NuphosLogo'

import type { ErrorInfo, ReactNode } from 'react'

type CrashSource = 'react_render' | 'window_error' | 'unhandled_rejection'

type CrashState = {
  error: unknown
  componentStack: string | null
  eventId: string | null
  source: CrashSource | null
}

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = CrashState & {
  copied: boolean
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(String(error))
  }
}

function formatCrashDetails(state: CrashState): string {
  const error = normalizeError(state.error)

  return [
    `Source: ${state.source ?? 'unknown'}`,
    state.eventId ? `PostHog event: ${state.eventId}` : null,
    `URL: ${window.location.href}`,
    `User agent: ${navigator.userAgent}`,
    '',
    `${error.name}: ${error.message}`,
    '',
    error.stack ? `Stack:\n${error.stack}` : null,
    state.componentStack ? `Component stack:\n${state.componentStack}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)

    return true
  } catch {
    return false
  }
}

function CrashPage({
  crash,
  copied,
  onCopy,
  onReload,
}: {
  crash: CrashState
  copied: boolean
  onCopy: () => void
  onReload: () => void
}) {
  const error = normalizeError(crash.error)
  const details = formatCrashDetails(crash)

  return (
    <main className="flex h-full w-full items-center justify-center overflow-auto bg-main px-6 py-8 text-main">
      <section className="flex w-full max-w-4xl flex-col gap-6">
        <header className="flex items-center gap-3">
          <NuphosLogo className="h-7 w-7 flex-shrink-0" variant="white-bg" />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main">Nuphos</div>
            <div className="text-[12px] text-tertiary">Renderer crash recovery</div>
          </div>
        </header>

        <div className="rounded-lg border border-zGray-800 bg-zGray-900/80 shadow-2xl shadow-black/20">
          <div className="flex items-start gap-4 border-b border-zGray-800 px-5 py-5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-error/35 bg-error/10 text-error">
              <AlertTriangle className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-semibold leading-tight text-main">
                Nuphos hit a renderer error
              </h1>
              <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-secondary">
                The app caught the crash before the window went blank. Reload to return to a clean
                state, or copy the diagnostics for debugging.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-tertiary">
                <span className="rounded-md border border-zGray-800 bg-zGray-950/60 px-2 py-1 font-mono">
                  {crash.source ?? 'unknown'}
                </span>
                {crash.eventId && (
                  <span className="rounded-md border border-zGray-800 bg-zGray-950/60 px-2 py-1 font-mono">
                    {crash.eventId}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div>
              <div className="text-[12px] font-medium uppercase text-tertiary">Error</div>
              <div className="mt-2 rounded-md border border-zGray-800 bg-zGray-950/70 px-3 py-2 font-mono text-[12.5px] leading-5 text-main">
                {error.name}: {error.message}
              </div>
            </div>

            <details className="rounded-md border border-zGray-800 bg-zGray-950/50" open>
              <summary className="cursor-default px-3 py-2 text-[12.5px] font-medium text-secondary hover:text-main">
                Diagnostics
              </summary>
              <pre
                className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-zGray-800 px-3 py-3 font-mono text-[11.5px] leading-5 text-secondary scrollbar-thin"
                data-ph-mask
              >
                {details}
              </pre>
            </details>
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zGray-800 bg-zGray-950/40 px-5 py-4">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zGray-700 bg-zGray-900 px-3 text-[12.5px] text-secondary hover:bg-zGray-800 hover:text-main"
            >
              <Clipboard className="h-3.5 w-3.5" strokeWidth={1.8} />
              {copied ? 'Copied' : 'Copy details'}
            </button>
            <button
              type="button"
              onClick={onReload}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white hover:bg-zViolet-600"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
              Reload
            </button>
          </footer>
        </div>
      </section>
    </main>
  )
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: null,
    copied: false,
    eventId: null,
    source: null,
  }

  componentDidMount() {
    window.addEventListener('error', this.handleWindowError)
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError)
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection)
  }

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { error, source: 'react_render', copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const eventId = captureRendererException(error, {
      kind: 'react_render_error',
      componentStack: info.componentStack,
    })

    this.setState({
      componentStack: info.componentStack ?? null,
      eventId,
      source: 'react_render',
    })
  }

  handleWindowError = (event: ErrorEvent) => {
    if (!event.error && !event.message) return
    const error = event.error ?? new Error(event.message)

    captureRendererException(error, {
      kind: 'window_error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  }

  handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = normalizeError(event.reason ?? 'Unhandled promise rejection')

    captureRendererException(error, { kind: 'unhandled_rejection' })
  }

  handleCopy = () => {
    void copyText(formatCrashDetails(this.state)).then((copied) => {
      this.setState({ copied })
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <CrashPage
          crash={this.state}
          copied={this.state.copied}
          onCopy={this.handleCopy}
          onReload={this.handleReload}
        />
      )
    }

    return <>{this.props.children}</>
  }
}
