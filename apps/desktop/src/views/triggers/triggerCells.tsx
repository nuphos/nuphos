import clsx from 'clsx'
import { Clock, Layers3, Loader2, Webhook } from 'lucide-react'

import { Tooltip } from '../../components/ui/tooltip'

import { triggerSourceTitle } from './shared'
import { rowName } from './triggerRows'

import type { TriggerListRow } from './triggerRows'
import type { ReactNode } from 'react'

/** The Name column: what the row is, plus anything wrong with it. */
export function NameCell({ row }: { row: TriggerListRow }) {
  const Icon = row.kind === 'group' ? Layers3 : row.trigger.triggerType === 'cron' ? Clock : Webhook

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-tertiary" strokeWidth={1.8} />
      <span className="truncate text-main">{rowName(row)}</span>
      <RowTags row={row} />
    </span>
  )
}

// "Agent" is on most rows, so the word alone tells the reader almost nothing —
// the tooltip is where it earns its place. One sentence: a tooltip that needs
// a paragraph is a sign the label itself is wrong.
const AGENT_TIP = 'Set up by the agent from a chat, rather than by hand.'

function RowTags({ row }: { row: TriggerListRow }) {
  if (row.kind === 'group') {
    return (
      <>
        <Tag
          tone="muted"
          tip={`A Watch group: ${String(row.group.expectedMemberCount)} monitored items sharing ${String(row.group.partitionCount)} webhook ingress${row.group.partitionCount === 1 ? '' : 'es'}. Its settings apply to every member.`}
        >
          Group
        </Tag>
        {row.group.state === 'partial' && (
          <Tag tone="error" tip="At least one shared webhook ingress failed to provision.">
            Needs attention
          </Tag>
        )}
        {row.group.state === 'provisioning' && (
          <Tag tone="accent" tip="Nuphos is still creating this group's webhook ingresses.">
            Provisioning
          </Tag>
        )}
        <Tag tone="accent" tip={AGENT_TIP}>
          Agent
        </Tag>
      </>
    )
  }
  const { trigger } = row

  return (
    <>
      {!trigger.enabled && !trigger.cleanupStatus && (
        <Tag tone="muted" tip="Disabled — it will not fire until you turn it back on.">
          Paused
        </Tag>
      )}
      {trigger.cleanupStatus === 'deleting' && (
        <Tag tone="accent" tip="Removing the resources this trigger created at its provider.">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Removing
        </Tag>
      )}
      {trigger.cleanupStatus === 'cleanup_failed' && (
        <Tag tone="error" tip="Provider cleanup did not finish. Retry it from the settings.">
          Cleanup needed
        </Tag>
      )}
      {trigger.source && trigger.source !== 'user' && (
        <Tag
          tone="accent"
          tip={trigger.source === 'agent' ? AGENT_TIP : triggerSourceTitle(trigger)}
        >
          {trigger.source === 'agent' ? 'Agent' : 'Automation'}
        </Tag>
      )}
    </>
  )
}

function Tag({
  tone,
  tip,
  children,
}: {
  tone: 'muted' | 'accent' | 'error'
  tip: ReactNode
  children: ReactNode
}) {
  return (
    <Tooltip content={tip}>
      <span
        className={clsx(
          'inline-flex flex-shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[10.5px] uppercase tracking-wide',
          tone === 'error' && 'border-error/40 text-error',
          tone === 'accent' && 'border-zViolet-500/40 text-zViolet-accent',
          tone === 'muted' && 'border-zGray-700 text-tertiary',
        )}
      >
        {children}
      </span>
    </Tooltip>
  )
}
