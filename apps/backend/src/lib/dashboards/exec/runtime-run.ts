import { readFile } from 'node:fs/promises'

import { config } from '@/config'
import { OpenAbRpcError } from '@/lib/claude-code-preview/openab-acp-errors'
import { runtimeBackendUrl } from '@/lib/claude-code-preview/runtime-backend-url'
import { redactSecrets } from '@/lib/journal/redact'

import {
  panelOutputSchema,
  ERROR_SENTINEL,
  outputMatchesKind,
  OUTPUT_SENTINEL,
} from '../panel-output'

import { PanelExecError } from './errors'
import { PANEL_JOB } from './runtime-select'

import type { PanelRuntime } from './runtime-select'
import type { DashboardPanel, DashboardPanelSnapshot } from '@/models'

/** The runtime enforces `timeoutMs` itself and reports `timedOut`; this margin
 *  only catches a runtime that stops answering. */
const JOB_CALL_GRACE_MS = 10_000

let runnerSourceCache: string | null = null

async function runnerSource(): Promise<string> {
  if (runnerSourceCache === null) {
    runnerSourceCache = await readFile(new URL('../panel-runner.mjs', import.meta.url), 'utf8')
  }

  return runnerSourceCache
}

/** Pull the sentinel-delimited JSON out of stdout, validate it, and confirm the
 *  output variant matches the panel's declared kind. */
export function parseOutput(
  stdout: string,
  panel: DashboardPanel,
): DashboardPanelSnapshot['output'] {
  const idx = stdout.lastIndexOf(OUTPUT_SENTINEL)

  if (idx === -1) {
    throw new PanelExecError('invalid_output', 'panel produced no sentinel output line')
  }
  const after = stdout.slice(idx + OUTPUT_SENTINEL.length)
  const line = after.split('\n', 1)[0] ?? ''
  let json: unknown

  try {
    json = JSON.parse(line)
  } catch {
    throw new PanelExecError('invalid_output', 'panel output was not valid JSON')
  }
  const parsed = panelOutputSchema.safeParse(json)

  if (!parsed.success) {
    throw new PanelExecError(
      'invalid_output',
      `panel output failed schema: ${parsed.error.message}`,
    )
  }
  if (!outputMatchesKind(parsed.data, panel.kind)) {
    throw new PanelExecError(
      'invalid_output',
      `panel kind is "${panel.kind}" but script emitted "${parsed.data.kind}"`,
    )
  }

  return parsed.data
}

/** Extract the diagnostic envelope and sanitize it again at the backend trust
 * boundary. Panel code controls stdout and can forge the runner sentinel, so
 * runner-side redaction alone must never be trusted before persistence. */
export function parseRunnerError(
  stdout: string,
  exactSecrets: readonly string[] = [],
): string | null {
  const idx = stdout.lastIndexOf(ERROR_SENTINEL)

  if (idx === -1) return null
  const after = stdout.slice(idx + ERROR_SENTINEL.length)
  const line = after.split('\n', 1)[0] ?? ''

  try {
    const parsed = JSON.parse(line) as unknown

    if (
      parsed &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof parsed.message === 'string'
    ) {
      let diagnostic = parsed.message

      // The bearer token is available to panel code and may appear without a
      // recognizable key or auth prefix. Redact exact runtime secrets first,
      // then apply the shared structural/entropy rules as defense in depth.
      for (const secret of exactSecrets) {
        if (secret.length >= 4)
          diagnostic = diagnostic.split(secret).join('[REDACTED:runtime-secret]')
      }

      return redactSecrets(diagnostic).redacted.slice(0, 4_000)
    }
  } catch {
    // A malformed envelope is untrusted output; use the generic exit message.
  }

  return null
}

export const RUNTIME_BUSY_MESSAGE =
  'The agent is busy with other jobs. Refresh the panel again in a moment.'
export const RUNTIME_LOST_MESSAGE =
  'The connection to the agent was lost while the panel was running. Refresh to try again.'
const RUNTIME_OUTDATED_JOB_MESSAGE =
  'The selected agent cannot run dashboard panels. Update it to the latest image in Settings → Agent, then refresh.'
const RUNTIME_KEY_REJECTED_MESSAGE =
  'The agent rejected its operator credential. Rotate it in the agent settings, then refresh.'
const PUBLIC_URL_MISSING_MESSAGE =
  'A self-hosted agent was selected, but this Nuphos deployment has no public backend URL for it to call. Set NUPHOS_PUBLIC_BACKEND_URL on the backend.'

function timeoutError(): PanelExecError {
  return new PanelExecError(
    'timeout',
    `panel timed out (limit ${String(config.dashboards.execTimeoutMs)}ms, or the agent's lower job cap)`,
  )
}

/** Transport failures become user-facing kinds; nothing the runtime said is echoed. */
export function classifyJobCallError(err: unknown): PanelExecError {
  if (err instanceof OpenAbRpcError) {
    if (err.code === -32005)
      return new PanelExecError('runtime_unavailable', RUNTIME_BUSY_MESSAGE, true)
    if (err.code === -32601 || err.code === -32007)
      return new PanelExecError('runtime_outdated', RUNTIME_OUTDATED_JOB_MESSAGE)
    if (err.code === -32003)
      return new PanelExecError('runtime_unavailable', RUNTIME_KEY_REJECTED_MESSAGE)

    return new PanelExecError('internal', 'The agent could not start the panel job.')
  }
  if (err instanceof Error && /timed out/iu.test(err.message)) return timeoutError()

  return new PanelExecError('runtime_unavailable', RUNTIME_LOST_MESSAGE, true)
}

type JobResult = { exitCode: number | null; stdout: string; truncated: boolean; timedOut: boolean }

function readJobResult(raw: Record<string, unknown>): JobResult {
  return {
    exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : null,
    stdout: typeof raw.stdout === 'string' ? raw.stdout : '',
    truncated: raw.truncated === true,
    timedOut: raw.timedOut === true,
  }
}

export async function runOnRuntime(args: {
  runtime: PanelRuntime
  jobId: string
  nuphosToken: string
  code: string
  params: Record<string, unknown>
  panel: DashboardPanel
}): Promise<{ output: DashboardPanelSnapshot['output']; durationMs: number }> {
  const { runtime, jobId, nuphosToken, code, params, panel } = args
  const backendUrl = runtimeBackendUrl(runtime.endpoint.external)

  if (!backendUrl) throw new PanelExecError('runtime_unavailable', PUBLIC_URL_MISSING_MESSAGE)
  const startedAt = Date.now()
  let raw: Record<string, unknown>

  try {
    raw = await runtime.client.runJob(
      {
        jobId,
        job: PANEL_JOB,
        stdin: JSON.stringify({ runner: await runnerSource(), script: code, params }),
        env: { NUPHOS_BACKEND_URL: backendUrl, NUPHOS_TOKEN: nuphosToken },
        timeoutMs: config.dashboards.execTimeoutMs,
        maxStdoutBytes: config.dashboards.maxOutputBytes,
      },
      config.dashboards.execTimeoutMs + JOB_CALL_GRACE_MS,
    )
  } catch (err) {
    throw classifyJobCallError(err)
  }
  const result = readJobResult(raw)

  if (result.timedOut) throw timeoutError()
  if (
    result.truncated ||
    Buffer.byteLength(result.stdout, 'utf8') > config.dashboards.maxOutputBytes
  ) {
    throw new PanelExecError(
      'oversize',
      `panel output exceeded ${String(config.dashboards.maxOutputBytes)} bytes`,
    )
  }
  if (result.exitCode !== 0) {
    const diagnostic = parseRunnerError(result.stdout, [nuphosToken])
    const exitMessage =
      result.exitCode === null || result.exitCode < 0
        ? 'panel process was terminated'
        : `panel exited with code ${String(result.exitCode)}`

    throw new PanelExecError(
      'nonzero_exit',
      diagnostic ? `${exitMessage}\n\n${diagnostic}` : exitMessage,
    )
  }

  return { output: parseOutput(result.stdout, panel), durationMs: Date.now() - startedAt }
}
