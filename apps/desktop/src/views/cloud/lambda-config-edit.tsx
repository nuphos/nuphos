import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'

import type { AwsLambdaFunction, AwsLambdaFunctionDetail } from '../../types'

export function LambdaConfigEditModal({
  fn,
  detail,
  updateConfig,
  onClose,
  onSaved,
}: {
  fn: AwsLambdaFunction
  detail: AwsLambdaFunctionDetail
  updateConfig: (
    fn: AwsLambdaFunction,
    updates: { memoryMb?: number; timeoutSec?: number; environment?: Record<string, string> },
  ) => Promise<void>
  onClose: () => void
  onSaved: () => void
}) {
  const [memory, setMemory] = useState(String(detail.memoryMb ?? 128))
  const [timeout_, setTimeout_] = useState(String(detail.timeoutSec ?? 3))
  const [envRows, setEnvRows] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(detail.environment).map(([key, value]) => ({ key, value })),
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const memoryMb = Number(memory)
    const timeoutSec = Number(timeout_)

    if (!Number.isInteger(memoryMb) || memoryMb < 128 || memoryMb > 10240) {
      toast.error('Invalid memory', 'Memory must be an integer between 128 and 10240 MB.')

      return
    }
    if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 900) {
      toast.error('Invalid timeout', 'Timeout must be an integer between 1 and 900 seconds.')

      return
    }
    const environment: Record<string, string> = {}

    for (const row of envRows) {
      const key = row.key.trim()

      if (!key) continue
      if (environment[key] !== undefined) {
        toast.error('Duplicate variable', `Environment variable ${key} appears more than once.`)

        return
      }
      environment[key] = row.value
    }
    setSaving(true)
    try {
      await updateConfig(fn, { memoryMb, timeoutSec, environment })
      onSaved()
    } catch (e) {
      toast.apiError('Could not update function', e, {
        fallback: 'Check your connection and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit configuration" description={fn.name} width={560}>
      <div className="px-5 py-4 space-y-3 text-[13px]">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[12px] text-secondary mb-1">Memory (MB)</div>
            <input
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              inputMode="numeric"
              className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
            />
          </label>
          <label className="block">
            <div className="text-[12px] text-secondary mb-1">Timeout (seconds)</div>
            <input
              value={timeout_}
              onChange={(e) => setTimeout_(e.target.value)}
              inputMode="numeric"
              className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
            />
          </label>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[12px] text-secondary">Environment variables</span>
            <button
              type="button"
              onClick={() => setEnvRows((rows) => [...rows, { key: '', value: '' }])}
              className="inline-flex items-center gap-1 text-[12px] text-zViolet-accent hover:underline"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={1.8} />
              Add
            </button>
          </div>
          <div className="flex flex-col gap-1.5 max-h-64 overflow-auto scrollbar-thin">
            {envRows.length === 0 && (
              <div className="text-[12px] text-tertiary italic">No environment variables.</div>
            )}
            {envRows.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={row.key}
                  onChange={(e) =>
                    setEnvRows((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
                    )
                  }
                  placeholder="KEY"
                  spellCheck={false}
                  className="flex-1 px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
                />
                <input
                  value={row.value}
                  onChange={(e) =>
                    setEnvRows((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  placeholder="value"
                  spellCheck={false}
                  className="flex-[2] px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={() => setEnvRows((rows) => rows.filter((_, j) => j !== i))}
                  className="text-tertiary hover:text-error shrink-0"
                  title="Remove variable"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-tertiary mt-1">
            Saving replaces the function's entire environment with the variables above.
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  )
}
