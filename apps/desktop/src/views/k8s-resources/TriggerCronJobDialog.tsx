import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { useResetOnKey } from '../useResetOnKey'

import { defaultJobName, DNS_1123_LABEL } from './jobName'

import type { CronJobItem, CronJobTriggerInfo } from '../../types'
import type { FormEvent } from 'react'

export function TriggerCronJobDialog({
  target,
  onClose,
}: {
  target: { cronJob: CronJobItem; context: string }
  onClose: () => void
}) {
  const { cronJob, context } = target
  const [info, setInfo] = useState<CronJobTriggerInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [jobName, setJobName] = useState(() => defaultJobName(cronJob.name))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(`${context}|${cronJob.namespace}|${cronJob.name}`, () => {
    setInfo(null)
    setLoadError(null)
  })

  useEffect(() => {
    let cancelled = false

    api
      .getCronJobTriggerInfo(context, cronJob.namespace, cronJob.name)
      .then((result) => {
        if (!cancelled) setInfo(result)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load CronJob.')
      })

    return () => {
      cancelled = true
    }
  }, [context, cronJob.namespace, cronJob.name])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = jobName.trim()

    if (!trimmed) {
      setError('Job name is required.')

      return
    }
    if (!DNS_1123_LABEL.test(trimmed)) {
      setError(
        'Job name must be a valid DNS-1123 label: lowercase alphanumeric or "-", start and end with an alphanumeric character, and be at most 63 characters.',
      )

      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.triggerCronJob(context, cronJob.namespace, cronJob.name, trimmed)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trigger CronJob.')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      title="Trigger CronJob"
      description={`${cronJob.namespace}/${cronJob.name}`}
      onClose={onClose}
      width={460}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4 p-4">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-tertiary">Job name</span>
          <input
            autoFocus
            value={jobName}
            onChange={(event) => setJobName(event.target.value)}
            className="h-9 w-full rounded-md border border-zGray-700 bg-field px-2.5 font-mono text-[13px] text-main outline-none focus:border-zViolet-500"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[12px] text-tertiary">Containers to be created</span>
          {loadError ? (
            <div className="text-[12.5px] text-error">{loadError}</div>
          ) : !info ? (
            <div className="text-[12.5px] text-tertiary">Loading…</div>
          ) : info.containers.length === 0 ? (
            <div className="text-[12.5px] text-tertiary">No containers found.</div>
          ) : (
            <div className="space-y-2 rounded-md border border-zGray-800 bg-zGray-950 p-2.5">
              {info.containers.map((c) => (
                <div key={c.name} className="min-w-0">
                  <div className="truncate text-[12.5px] text-main" title={c.name}>
                    {c.name}
                  </div>
                  <div className="truncate font-mono text-[11.5px] text-secondary" title={c.image}>
                    {c.image}
                  </div>
                  {(c.command.length > 0 || c.args.length > 0) && (
                    <div
                      className="truncate font-mono text-[11px] text-tertiary"
                      title={[...c.command, ...c.args].join(' ')}
                    >
                      {[...c.command, ...c.args].join(' ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="text-[12.5px] text-error">{error}</div>}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md px-3 text-[12.5px] text-secondary hover:bg-zGray-800 hover:text-main"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !info || !!loadError}
            className="h-8 rounded-md bg-zViolet-600 px-3 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Triggering…' : 'Trigger'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
