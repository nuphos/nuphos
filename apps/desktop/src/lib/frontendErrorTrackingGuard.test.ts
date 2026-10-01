import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const SRC = join(import.meta.dirname, '..')

function source(path: string): string {
  return readFileSync(join(SRC, path), 'utf8')
}

function sourceFiles(path: string): string[] {
  const absolute = join(SRC, path)

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)

    if (entry.isDirectory()) return sourceFiles(child)

    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [child] : []
  })
}

test('the shared frontend error funnel emits a PostHog exception', () => {
  const analytics = source('lib/analytics.ts')
  const start = analytics.indexOf('export function trackError(')
  const end = analytics.indexOf('\nexport function trackPageview(', start)
  const body = analytics.slice(start, end)

  assert.ok(start >= 0 && end > start, 'trackError implementation was not found')
  assert.match(body, /posthog\.captureException\(/)
})

test('the exported renderer API is instrumented for rejections and stalls', () => {
  const api = source('api.ts')

  assert.match(api, /export const api = instrumentApi\(/)
  assert.match(api, /reportFrontendError\(/)
  assert.match(api, /observeStall:/)
})

test('global UI failure surfaces use the shared exception funnel', () => {
  assert.match(source('components/ui/toast.ts'), /trackError\(/)

  const boundary = source('components/AppErrorBoundary.tsx')

  assert.match(boundary, /componentDidCatch[\s\S]*captureRendererException\(/)
  assert.match(boundary, /handleWindowError[\s\S]*captureRendererException\(/)
  assert.match(boundary, /handleUnhandledRejection[\s\S]*captureRendererException\(/)

  const visibleError = source('components/VisibleErrorReporter.tsx')

  assert.match(visibleError, /useEffect\([\s\S]*trackError\(/)
})

test('every agentStart surface reports a rejected start', () => {
  const paths = sourceFiles('components/agent').filter((path) =>
    source(path).includes('.agentStart('),
  )

  for (const path of paths) {
    const text = source(path)

    assert.ok(
      text.includes('trackError(') || text.includes('toast.apiError('),
      `${path} can reject agentStart without reporting it`,
    )
  }
})

test('agent stream failure events reach the shared exception funnel', () => {
  const streamEvents = source('components/agent/panel/agentEventsApply.ts')

  assert.match(
    streamEvents,
    /if \(evType === 'error'\)[\s\S]*?trackError\(\{[\s\S]*?phase: 'ipc_error'/,
    'IPC-level agent stream errors can reach the error UI without entering PostHog Error Tracking',
  )
  assert.match(
    streamEvents,
    /if \(sse\.type === 'error'\)[\s\S]*?trackError\(\{[\s\S]*?phase: 'sse_error_frame'/,
    'SSE agent error frames can reach the error UI without entering PostHog Error Tracking',
  )
  assert.match(
    streamEvents,
    /sse\.type === 'tool-output-error'[\s\S]*?trackError\(\{[\s\S]*?phase: 'tool_output_error'/,
    'Agent tool failures can render an error card without entering PostHog Error Tracking',
  )
})

test('successful transport responses with failure payloads are reported', () => {
  const watch = source('hooks/useWatchedList.ts')

  assert.match(watch, /ev\.state === 'disconnected'[\s\S]*reportFrontendError\(/)
  assert.match(watch, /if \(res\.error\)[\s\S]*reportFrontendError\(/)

  for (const path of [
    'grafana/client/base.ts',
    'grafana/client/alerts.ts',
    'grafana/client/dashboards.ts',
    'grafana/client/tempo.ts',
  ]) {
    assert.match(
      source(path),
      /createReportedError\(/,
      `${path} converts a successful response into an unreported UI error`,
    )
  }
})

test('browser API failures are not silently swallowed', () => {
  for (const path of sourceFiles('.')) {
    const text = source(path)

    assert.doesNotMatch(
      text,
      /navigator\.clipboard\.writeText\([^;]*?\.catch\(\(\) => \{\}\)/s,
      `${path} silently swallows a clipboard failure`,
    )
  }
})
