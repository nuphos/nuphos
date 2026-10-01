import { useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '../../components/ui/toast'
import { useReportLoading } from '../../components/useReportLoading'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'
import { useResetOnKey } from '../useResetOnKey'

import { ErrorBlock } from './ErrorBlock'

import type { AwsLambdaFunction, AwsLambdaInvokeResult, AwsLambdaTriggers } from '../../types'

export function LambdaTestPanel({
  fn,
  invoke,
  onCount,
}: {
  fn: AwsLambdaFunction
  invoke: (fn: AwsLambdaFunction, payload: string) => Promise<AwsLambdaInvokeResult>
  onCount: (n: number) => void
}) {
  const payloadStorageKey = `atlas.lambda-test-payload.${fn.arn}`
  const [payload, setPayload] = useState(() => {
    try {
      return localStorage.getItem(payloadStorageKey) ?? '{}'
    } catch {
      return '{}'
    }
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AwsLambdaInvokeResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useReportVisibleError(result?.functionError, 'lambda_invocation_function_error')

  useEffect(() => {
    onCount(result ? 1 : 0)
  }, [result, onCount])

  const run = async () => {
    if (running) return
    if (payload.trim()) {
      try {
        JSON.parse(payload)
      } catch {
        toast.error('Invalid payload', 'The test payload must be valid JSON.')

        return
      }
    }
    try {
      localStorage.setItem(payloadStorageKey, payload)
    } catch {
      // localStorage is best-effort persistence for the payload draft
    }
    setRunning(true)
    setErrorMessage(null)
    try {
      const r = await invoke(fn, payload)

      setResult(r)
    } catch (e) {
      setErrorMessage(String(e instanceof Error ? e.message : e))
    } finally {
      setRunning(false)
    }
  }

  const prettyPayload = useMemo(() => {
    if (!result?.payload) return ''
    try {
      return JSON.stringify(JSON.parse(result.payload), null, 2)
    } catch {
      return result.payload
    }
  }, [result])

  return (
    <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-3">
      <div className="max-w-3xl flex flex-col gap-3">
        <div>
          <div className="text-[11px] text-tertiary uppercase tracking-wider mb-1.5">
            Event payload (JSON)
          </div>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            rows={8}
            className="w-full px-2.5 py-2 rounded bg-field border border-zGray-800 text-[12px] font-mono text-secondary focus:outline-none focus:border-zViolet-accent/60 resize-y"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="h-8 px-3 rounded bg-zViolet-accent text-white hover:bg-zViolet-accent/85 text-[12.5px] disabled:opacity-50"
          >
            {running ? 'Invoking…' : 'Invoke'}
          </button>
          <span className="text-[11.5px] text-tertiary">
            Synchronous (RequestResponse) invocation against the live function.
          </span>
        </div>

        {errorMessage && <ErrorBlock message={errorMessage} />}

        {result && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-[12px]">
              <span
                className={`px-2 py-0.5 rounded font-medium ${
                  result.functionError ? 'bg-error/15 text-error' : 'bg-[#73bf69]/15 text-[#73bf69]'
                }`}
              >
                {result.functionError ? `Failed: ${result.functionError}` : 'Succeeded'}
              </span>
              <span className="text-tertiary">
                HTTP {result.statusCode ?? '—'}
                {result.executedVersion ? ` · version ${result.executedVersion}` : ''}
              </span>
            </div>
            <div>
              <div className="text-[11px] text-tertiary uppercase tracking-wider mb-1.5">
                Response
              </div>
              <pre className="px-2.5 py-2 rounded bg-zGray-900 border border-zGray-800 text-[11.5px] font-mono text-secondary whitespace-pre-wrap break-all max-h-64 overflow-auto scrollbar-thin">
                {prettyPayload || '(empty response)'}
              </pre>
            </div>
            {result.logTail && (
              <div>
                <div className="text-[11px] text-tertiary uppercase tracking-wider mb-1.5">
                  Log output (tail)
                </div>
                <pre className="px-2.5 py-2 rounded bg-zGray-900 border border-zGray-800 text-[11.5px] font-mono text-secondary whitespace-pre-wrap break-all max-h-72 overflow-auto scrollbar-thin">
                  {result.logTail}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function LambdaTriggersPanel({
  fn,
  loader,
  onCount,
  onLoading,
  refreshKey,
}: {
  fn: AwsLambdaFunction
  loader: (fn: AwsLambdaFunction) => Promise<AwsLambdaTriggers>
  onCount: (n: number) => void
  onLoading?: (loading: boolean) => void
  refreshKey: number
}) {
  const [triggers, setTriggers] = useState<AwsLambdaTriggers | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const loaderRef = useRef(loader)

  useEffect(() => {
    loaderRef.current = loader
  })
  useReportLoading(loading, onLoading)

  useResetOnKey(`${fn.name}|${fn.region}|${String(refreshKey)}`, () => {
    setLoading(true)
    setErrorMessage(null)
  })
  useEffect(() => {
    let cancelled = false

    loaderRef
      .current(fn)
      .then((t) => {
        if (cancelled) return
        setTriggers(t)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErrorMessage(String(e instanceof Error ? e.message : e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fn, refreshKey])

  const total = (triggers?.eventSourceMappings.length ?? 0) + (triggers?.policyTriggers.length ?? 0)

  useEffect(() => {
    onCount(total)
  }, [total, onCount])

  if (errorMessage) return <ErrorBlock message={errorMessage} />
  if (loading && !triggers) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-tertiary">
        Loading triggers...
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-4 py-3">
      <div className="max-w-3xl flex flex-col gap-4">
        <div>
          <div className="text-[11px] text-tertiary uppercase tracking-wider mb-1.5">
            Event source mappings ({triggers?.eventSourceMappings.length ?? 0})
          </div>
          {!triggers || triggers.eventSourceMappings.length === 0 ? (
            <div className="text-[12px] text-tertiary italic">
              No poll-based event sources (SQS / Kinesis / DynamoDB).
            </div>
          ) : (
            <div className="border border-zGray-800 rounded bg-zGray-900 divide-y divide-zGray-850">
              {triggers.eventSourceMappings.map((m) => (
                <div key={m.uuid} className="px-2.5 py-1.5 text-[11.5px]">
                  <div className="font-mono text-secondary break-all">
                    {m.eventSourceArn ?? m.uuid}
                  </div>
                  <div className="text-tertiary mt-0.5">
                    {m.state ?? 'unknown'}
                    {m.batchSize != null ? ` · batch ${String(m.batchSize)}` : ''}
                    {m.lastModified ? ` · modified ${m.lastModified.slice(0, 10)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] text-tertiary uppercase tracking-wider mb-1.5">
            Resource policy triggers ({triggers?.policyTriggers.length ?? 0})
          </div>
          {!triggers || triggers.policyTriggers.length === 0 ? (
            <div className="text-[12px] text-tertiary italic">
              No push-based invokers (API Gateway / S3 / EventBridge…) in the resource policy.
            </div>
          ) : (
            <div className="border border-zGray-800 rounded bg-zGray-900 divide-y divide-zGray-850">
              {triggers.policyTriggers.map((p, i) => (
                <div key={p.statementId ?? i} className="px-2.5 py-1.5 text-[11.5px]">
                  <div className="text-secondary">{p.principal}</div>
                  {p.sourceArn && (
                    <div className="font-mono text-tertiary mt-0.5 break-all">{p.sourceArn}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
