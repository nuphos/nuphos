import { faBolt, faPause, faPlay } from '@fortawesome/free-solid-svg-icons'
import { Pause, Play } from 'lucide-react'
import { useCallback, useState } from 'react'

import { api } from '../../api'
import { Age } from '../../components/Age'
import { t } from '../../i18n'
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
        label: t('Trigger job'),
        icon: Play,
        onSelect: () => setTriggerTarget({ cronJob, context }),
      },
      {
        key: 'toggle-suspend-cronjob',
        label: cronJob.suspend ? t('Resume schedule') : t('Suspend schedule'),
        icon: cronJob.suspend ? Play : Pause,
        confirm: cronJob.suspend
          ? t('Resume CronJob "{name}"? Scheduled jobs will run again.', {
              name: `${cronJob.namespace}/${cronJob.name}`,
            })
          : t('Suspend CronJob "{name}"? No new jobs will be scheduled until resumed.', {
              name: `${cronJob.namespace}/${cronJob.name}`,
            }),
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
            label: t('Suspend'),
            icon: faPause,
            confirm:
              selected.length === 1
                ? t('Suspend {n} CronJob? Scheduled runs stop until resumed.', { n: 1 })
                : t('Suspend {n} CronJobs? Scheduled runs stop until resumed.', {
                    n: selected.length,
                  }),
            onClick: async () => {
              await runBulk(
                selected,
                (c) => api.setCronJobSuspend(ctx, c.namespace, c.name, true),
                t('Suspend CronJobs'),
              )
              clear()
            },
          },
          {
            key: 'resume',
            label: t('Resume'),
            icon: faPlay,
            confirm:
              selected.length === 1
                ? t(
                    "Resume {n} CronJob? Scheduling continues from each CronJob's cron expression.",
                    { n: 1 },
                  )
                : t(
                    "Resume {n} CronJobs? Scheduling continues from each CronJob's cron expression.",
                    { n: selected.length },
                  ),
            onClick: async () => {
              await runBulk(
                selected,
                (c) => api.setCronJobSuspend(ctx, c.namespace, c.name, false),
                t('Resume CronJobs'),
              )
              clear()
            },
          },
          {
            key: 'trigger',
            label: t('Trigger|action'),
            icon: faBolt,
            confirm:
              selected.length === 1
                ? t(
                    'Trigger {n} CronJob now? This immediately creates {n} Job and cannot be undone.',
                    { n: 1 },
                  )
                : t(
                    'Trigger {n} CronJobs now? This immediately creates {n} Jobs and cannot be undone.',
                    { n: selected.length },
                  ),
            onClick: async () => {
              await runBulk(
                selected,
                (c) => api.triggerCronJob(ctx, c.namespace, c.name, defaultJobName(c.name)),
                t('Trigger CronJobs'),
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
            header: t('Schedule'),
            width: 160,
            sortAccessor: (r) => r.schedule,
            render: (r) => (
              <span className="font-mono text-[12px] text-secondary">{r.schedule}</span>
            ),
          },
          {
            key: 'suspend',
            header: t('Suspend|state'),
            width: 90,
            sortAccessor: (r) => r.suspend,
            render: (r) =>
              r.suspend ? (
                <span className="text-warning">{t('Yes')}</span>
              ) : (
                <span className="text-tertiary">{t('No')}</span>
              ),
          },
          {
            key: 'active',
            header: t('Active'),
            width: 80,
            sortAccessor: (r) => r.active,
            render: (r) => r.active,
          },
          {
            key: 'last_schedule',
            header: t('Last Schedule'),
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
