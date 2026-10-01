import { faBolt, faPause, faPlay } from '@fortawesome/free-solid-svg-icons'
import { Pause, Play } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { runBulk } from '../../lib/bulkActions'
import { cronJobPhase } from '../../lib/workloadStatus'

import { defaultJobName } from './jobName'
import { cronJobDeleteTarget } from './shared'
import { NamespacedTable } from './tables'
import { TriggerCronJobDialog } from './TriggerCronJobDialog'

import type { NamespacedProps, RowActionFactory } from './shared'
import type { CronJobItem } from '../../types'

export function CronJobsView(props: NamespacedProps<CronJobItem>) {
  const [triggerTarget, setTriggerTarget] = useState<{
    cronJob: CronJobItem
    context: string
  } | null>(null)

  const rowActions = useCallback<RowActionFactory<CronJobItem>>(
    (cronJob, context) => [
      {
        key: 'trigger-cronjob',
        label: 'Trigger job',
        icon: Play,
        onSelect: () => setTriggerTarget({ cronJob, context }),
      },
      {
        key: 'toggle-suspend-cronjob',
        label: cronJob.suspend ? 'Resume schedule' : 'Suspend schedule',
        icon: cronJob.suspend ? Play : Pause,
        confirm: cronJob.suspend
          ? `Resume CronJob "${cronJob.namespace}/${cronJob.name}"? Scheduled jobs will run again.`
          : `Suspend CronJob "${cronJob.namespace}/${cronJob.name}"? No new jobs will be scheduled until resumed.`,
        onSelect: async () => {
          await api.setCronJobSuspend(context, cronJob.namespace, cronJob.name, !cronJob.suspend)
        },
      },
    ],
    [],
  )

  return (
    <>
      {triggerTarget && (
        <TriggerCronJobDialog target={triggerTarget} onClose={() => setTriggerTarget(null)} />
      )}
      <NamespacedTable
        {...props}
        loader={api.listCronJobs}
        storageKey="cronjobs"
        deleteTarget={cronJobDeleteTarget}
        rowActions={rowActions}
        bulkActions={(selected, clear, ctx) => [
          {
            key: 'suspend',
            label: 'Suspend',
            icon: faPause,
            confirm: `Suspend ${String(selected.length)} CronJob${selected.length === 1 ? '' : 's'}? Scheduled runs stop until resumed.`,
            onClick: async () => {
              await runBulk(
                selected,
                (c) => api.setCronJobSuspend(ctx, c.namespace, c.name, true),
                { verbing: 'suspend', verbed: 'Suspended', noun: 'CronJob' },
              )
              clear()
            },
          },
          {
            key: 'resume',
            label: 'Resume',
            icon: faPlay,
            confirm: `Resume ${String(selected.length)} CronJob${selected.length === 1 ? '' : 's'}? Scheduling continues from each CronJob's cron expression.`,
            onClick: async () => {
              await runBulk(
                selected,
                (c) => api.setCronJobSuspend(ctx, c.namespace, c.name, false),
                { verbing: 'resume', verbed: 'Resumed', noun: 'CronJob' },
              )
              clear()
            },
          },
          {
            key: 'trigger',
            label: 'Trigger',
            icon: faBolt,
            confirm: `Trigger ${String(selected.length)} CronJob${selected.length === 1 ? '' : 's'} now? This immediately creates ${String(selected.length)} Job${selected.length === 1 ? '' : 's'} and cannot be undone.`,
            onClick: async () => {
              await runBulk(
                selected,
                (c) => api.triggerCronJob(ctx, c.namespace, c.name, defaultJobName(c.name)),
                { verbing: 'trigger', verbed: 'Triggered', noun: 'CronJob' },
              )
              clear()
            },
          },
        ]}
        filterRecord={(r) => ({
          text: [r.name, r.namespace, r.schedule],
          fields: {
            status: cronJobPhase(r),
            ns: r.namespace,
            namespace: r.namespace,
          },
        })}
        columns={[
          {
            key: 'schedule',
            header: 'Schedule',
            width: 160,
            sortAccessor: (r) => r.schedule,
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.schedule}</span>
            ),
          },
          {
            key: 'suspend',
            header: 'Suspend',
            width: 90,
            sortAccessor: (r) => r.suspend,
            render: (r) =>
              r.suspend ? (
                <span className="text-warning">Yes</span>
              ) : (
                <span className="text-tertiary">No</span>
              ),
          },
          {
            key: 'active',
            header: 'Active',
            width: 80,
            sortAccessor: (r) => r.active,
            render: (r) => r.active,
          },
          {
            key: 'last_schedule',
            header: 'Last Schedule',
            width: 140,
            sortAccessor: (r) => r.last_schedule ?? '',
            render: (r) => (
              <span className="text-tertiary">
                <Age value={r.last_schedule} />
              </span>
            ),
          },
        ]}
      />
    </>
  )
}
