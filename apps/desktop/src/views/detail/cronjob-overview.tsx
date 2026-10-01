import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { K8sStatus as StatusBadge } from '../../components/K8sHealth'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'
import { useRequiredKubeContext } from '../../hooks/useKubeContext'
import { useResetOnKey } from '../useResetOnKey'

import { Field, Section } from './shared'

import type { DetailTarget } from './target'
import type { CronJobDetail, CronJobJobItem } from '../../types'

// CronJob detail: surfaces the cron's schedule/policy parameters and the
// Jobs it has spawned (newest first), mirroring Aptakube's CronJob view.
// Clicking a Job row drills into that Job's detail.
export function CronJobOverview({
  namespace,
  name,
  refreshKey,
  onNavigate,
}: {
  namespace: string
  name: string
  refreshKey: number
  onNavigate?: (target: DetailTarget) => void
}) {
  const context = useRequiredKubeContext()
  const [data, setData] = useState<CronJobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useResetOnKey(`${context}\0${namespace}\0${name}`, () => {
    setData(null)
    setError(null)
  })

  useEffect(() => {
    let cancelled = false

    api
      .getCronJobDetail(context, namespace, name)
      .then((d) => {
        if (cancelled) return
        setError(null)
        setData(d)
      })
      .catch((e: unknown) => !cancelled && setError(String(e)))

    return () => {
      cancelled = true
    }
  }, [context, namespace, name, refreshKey])

  if (error) return <div className="p-6 text-error text-[13px]">{error}</div>
  if (!data) return <div className="p-6 text-tertiary text-[13px]">Loading…</div>

  return (
    <div className="p-6 space-y-5">
      <Section>
        <Field label="Age" value={<Age value={data.age} />} />
        <Field
          label="Labels"
          value={
            <div className="flex flex-wrap gap-1.5">
              {data.labels.map(([k, v]) => (
                <span
                  key={k}
                  className="bg-zGray-800 px-1.5 py-0.5 rounded text-[11.5px] text-secondary font-mono"
                >
                  {k}: {v}
                </span>
              ))}
              {data.labels.length === 0 && <span className="text-tertiary">-</span>}
            </div>
          }
        />
        <Field
          label="Namespace"
          value={<span className="text-zViolet-accent">{data.namespace}</span>}
        />
        <Field
          label="Annotations"
          value={
            data.annotations.length === 0 ? (
              <span className="text-tertiary">-</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {data.annotations.slice(0, 4).map(([k, v]) => (
                  <span
                    key={k}
                    title={`${k}: ${v}`}
                    className="max-w-full truncate bg-zGray-800 px-1.5 py-0.5 rounded text-[11px] text-tertiary font-mono"
                  >
                    {k}
                  </span>
                ))}
                {data.annotations.length > 4 && (
                  <span className="text-tertiary text-[11px]">
                    +{data.annotations.length - 4} more
                  </span>
                )}
              </div>
            )
          }
        />
      </Section>

      <Section>
        <Field
          label="Schedule"
          value={<span className="font-mono text-[12px]">{data.schedule || '-'}</span>}
        />
        <Field
          label="Time zone"
          value={
            data.time_zone ? (
              <span className="font-mono text-[12px]">{data.time_zone}</span>
            ) : (
              <span className="text-tertiary">Controller local time</span>
            )
          }
        />
        <Field
          label="Last Schedule"
          value={data.last_schedule ? <Age value={data.last_schedule} /> : '-'}
        />
        <Field
          label="Last Successful"
          value={data.last_successful ? <Age value={data.last_successful} /> : '-'}
        />
        <Field
          label="Suspended"
          value={data.suspend ? <span className="text-warning">Yes</span> : 'No'}
        />
        <Field label="Concurrency Policy" value={data.concurrency_policy} />
        <Field label="Active" value={String(data.active)} />
        <Field
          label="Successful Jobs History Limit"
          value={
            data.successful_jobs_history_limit != null
              ? String(data.successful_jobs_history_limit)
              : '-'
          }
        />
        <Field
          label="Failed Jobs History Limit"
          value={
            data.failed_jobs_history_limit != null ? String(data.failed_jobs_history_limit) : '-'
          }
        />
        {data.starting_deadline_seconds != null && (
          <Field label="Starting Deadline" value={`${String(data.starting_deadline_seconds)}s`} />
        )}
      </Section>

      <CronJobJobsSection
        jobs={data.jobs}
        error={data.jobs_error}
        onSelect={
          onNavigate
            ? (j) => onNavigate({ kind: 'Job', namespace: j.namespace, name: j.name })
            : undefined
        }
      />
    </div>
  )
}

function CronJobJobsSection({
  jobs,
  error,
  onSelect,
}: {
  jobs: CronJobJobItem[]
  error?: string | null
  onSelect?: (job: CronJobJobItem) => void
}) {
  useReportVisibleError(error, 'cronjob_jobs_error')

  return (
    <div>
      <div className="mb-2 text-[11.5px] uppercase tracking-wider text-tertiary">Jobs</div>
      {error ? (
        <div className="border border-error/30 bg-error/10 px-4 py-3 text-[12.5px] text-error">
          Could not load Jobs: {error}
        </div>
      ) : jobs.length === 0 ? (
        <div className="border border-zGray-800 bg-zGray-900 px-4 py-5 text-[12.5px] text-tertiary">
          No Jobs have been spawned by this CronJob yet.
        </div>
      ) : (
        <div className="overflow-hidden border border-zGray-800 rounded-md">
          <div className="grid grid-cols-[minmax(220px,2fr)_110px_110px_90px_110px_90px] border-b border-zGray-800 bg-zGray-900 px-3 py-2 text-[11.5px] uppercase tracking-wider text-tertiary">
            <div>Name</div>
            <div>Status</div>
            <div>Completions</div>
            <div>Failures</div>
            <div>Duration</div>
            <div>Age</div>
          </div>
          {jobs.map((j) => (
            <div
              key={`${j.namespace}/${j.name}`}
              onClick={() => onSelect?.(j)}
              className={clsx(
                'grid grid-cols-[minmax(220px,2fr)_110px_110px_90px_110px_90px] items-center border-b border-zGray-850 px-3 py-2 text-[12.5px] last:border-b-0',
                onSelect && 'hover:bg-zGray-850',
              )}
            >
              <div className="min-w-0 truncate text-zViolet-accent" title={j.name}>
                {j.name}
              </div>
              <div>
                <StatusBadge status={j.status} />
              </div>
              <div className="font-mono text-[12px] text-secondary">{j.completions}</div>
              <div className="font-mono text-[12px] text-secondary">{j.failed}</div>
              <div className="text-tertiary">{j.duration ?? '-'}</div>
              <div className="text-tertiary">
                <Age value={j.age} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
