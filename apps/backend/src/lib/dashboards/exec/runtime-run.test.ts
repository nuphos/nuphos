import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { OpenAbRpcError } from '@/lib/claude-code-preview/openab-acp-errors'

import { ERROR_SENTINEL, OUTPUT_SENTINEL } from '../panel-output'

import { PanelExecError } from './errors'
import { parseRunnerError, RUNTIME_BUSY_MESSAGE, runOnRuntime } from './runtime-run'

import type { PanelRuntime } from './runtime-select'
import type { RuntimeJobRequest } from '@/lib/claude-code-preview/openab-acp-lifecycle'
import type { DashboardPanel } from '@/models'

describe('parseRunnerError', () => {
  test('extracts a diagnostic envelope', () => {
    const stdout = `script log\n${ERROR_SENTINEL}${JSON.stringify({ message: 'fetch failed: 401' })}\n`

    expect(parseRunnerError(stdout)).toBe('fetch failed: 401')
  })

  test('ignores missing or malformed envelopes', () => {
    expect(parseRunnerError('ordinary script output')).toBeNull()
    expect(parseRunnerError(`${ERROR_SENTINEL}{not-json}\n`)).toBeNull()
  })

  test('redacts forged envelopes again at the backend boundary', () => {
    const token = 'runtime-token-panel-can-read'
    const stdout = `${ERROR_SENTINEL}${JSON.stringify({
      message: `request failed with ${token}; apiKey=hardcoded-secret`,
    })}\n`
    const diagnostic = parseRunnerError(stdout, [token])

    expect(diagnostic).toContain('[REDACTED:runtime-secret]')
    expect(diagnostic).toContain('[REDACTED:secret-assignment]')
    expect(diagnostic).not.toContain(token)
    expect(diagnostic).not.toContain('hardcoded-secret')
  })

  test('bounds forged diagnostic envelopes', () => {
    const stdout = `${ERROR_SENTINEL}${JSON.stringify({ message: 'x'.repeat(5_000) })}\n`

    expect(parseRunnerError(stdout)).toHaveLength(4_000)
  })
})

const panel = { _id: new ObjectId(), kind: 'scalar' } as DashboardPanel
const scalar = { kind: 'scalar', title: 'Total', value: 42, unit: 'usd' }
const token = 'panel-token-value'

function runtime(
  answer: (request: RuntimeJobRequest, callTimeoutMs: number) => Promise<Record<string, unknown>>,
  external = true,
): PanelRuntime {
  return {
    endpoint: { url: 'wss://rt.example/acp', authKey: 'k', runtimeId: 'rt-1', external },
    client: { supportsRuntimeJob: () => true, runJob: answer },
  }
}

function run(target: PanelRuntime) {
  return runOnRuntime({
    runtime: target,
    jobId: 'job-1',
    nuphosToken: token,
    code: 'emit(1)',
    params: { teamId: 't' },
    panel,
  })
}

async function failure(promise: Promise<unknown>): Promise<PanelExecError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof PanelExecError) return err
    throw err
  }
  throw new Error('expected the run to fail')
}

describe('runOnRuntime', () => {
  test('sends the panel job and parses its output', async () => {
    let sent: RuntimeJobRequest | undefined
    let deadline = 0
    const result = await run(
      runtime((request, callTimeoutMs) => {
        sent = request
        deadline = callTimeoutMs

        return Promise.resolve({
          exitCode: 0,
          stdout: `log\n${OUTPUT_SENTINEL}${JSON.stringify(scalar)}\n`,
          truncated: false,
          timedOut: false,
        })
      }),
    )

    expect(result.output).toEqual(scalar as never)
    expect(sent?.job).toBe('panel')
    expect(sent?.env).toEqual({
      NUPHOS_BACKEND_URL: 'https://unit-test.invalid',
      NUPHOS_TOKEN: token,
    })
    expect(sent?.timeoutMs).toBe(config.dashboards.execTimeoutMs)
    expect(sent?.maxStdoutBytes).toBe(config.dashboards.maxOutputBytes)
    expect(deadline).toBe(config.dashboards.execTimeoutMs + 10_000)
    const stdin = JSON.parse(sent?.stdin ?? '{}') as Record<string, unknown>

    expect(stdin.script).toBe('emit(1)')
    expect(stdin.params).toEqual({ teamId: 't' })
    expect(String(stdin.runner)).toContain('__PANEL_OUTPUT__')
  })

  test('maps runtime-reported limits to snapshot error kinds', async () => {
    const timedOut = await failure(
      run(runtime(() => Promise.resolve({ exitCode: null, stdout: '', timedOut: true }))),
    )
    const oversize = await failure(
      run(runtime(() => Promise.resolve({ exitCode: 0, stdout: 'x', truncated: true }))),
    )

    expect(timedOut.kind).toBe('timeout')
    expect(oversize.kind).toBe('oversize')
  })

  test('reports a nonzero exit with the redacted runner diagnostic', async () => {
    const err = await failure(
      run(
        runtime(() =>
          Promise.resolve({
            exitCode: 1,
            stdout: `${ERROR_SENTINEL}${JSON.stringify({ message: '401 for ' + token })}\n`,
          }),
        ),
      ),
    )

    expect(err.kind).toBe('nonzero_exit')
    expect(err.message).toContain('panel exited with code 1')
    expect(err.message).not.toContain(token)
  })

  test('classifies transport failures', async () => {
    const busy = await failure(
      run(runtime(() => Promise.reject(new OpenAbRpcError('busy', -32005)))),
    )
    const lost = await failure(
      run(runtime(() => Promise.reject(new Error('OpenAB ACP connection closed')))),
    )
    const outdated = await failure(
      run(runtime(() => Promise.reject(new OpenAbRpcError('Method not found', -32601)))),
    )
    const unknownJob = await failure(
      run(runtime(() => Promise.reject(new OpenAbRpcError('unknown job', -32007)))),
    )
    const deadline = await failure(
      run(runtime(() => Promise.reject(new Error('OpenAB ACP _openab/runtime/job timed out')))),
    )

    expect([busy.kind, busy.retryable, busy.message]).toEqual([
      'runtime_unavailable',
      true,
      RUNTIME_BUSY_MESSAGE,
    ])
    expect([lost.kind, lost.retryable]).toEqual(['runtime_unavailable', true])
    expect([outdated.kind, outdated.retryable]).toEqual(['runtime_outdated', false])
    expect(unknownJob.kind).toBe('runtime_outdated')
    expect([deadline.kind, deadline.retryable]).toEqual(['timeout', false])
  })
})
