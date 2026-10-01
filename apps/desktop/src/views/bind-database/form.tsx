import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import type { DatabaseConnectionTestResult } from '../../types'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[12px] text-secondary">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-tertiary">{hint}</div>}
    </label>
  )
}

export function TestResultPanel({ testResult }: { testResult: DatabaseConnectionTestResult }) {
  const writeCapable = testResult.health.readOnly === 'writable'

  return (
    <div
      className={`rounded-lg border p-3 text-[12px] ${writeCapable ? 'border-warning/30 bg-warning/5' : 'border-success/30 bg-success/5'}`}
    >
      <div
        className={`flex items-center gap-2 font-medium ${writeCapable ? 'text-warning' : 'text-success'}`}
      >
        {writeCapable ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        Connection succeeded in {testResult.health.latencyMs} ms
      </div>
      <div className="mt-1 text-secondary">
        {testResult.endpoint} · {testResult.databaseName ?? 'default database'} ·{' '}
        {writeCapable
          ? 'write-capable credential'
          : testResult.health.readOnly === 'verified'
            ? 'read-only credential'
            : 'credential capability unverified'}
      </div>
      {writeCapable && (
        <div className="mt-1.5 text-tertiary">
          The credential can write, but Agent access is still limited to the selected metadata or
          read-only gateway policy.
        </div>
      )}
    </div>
  )
}
