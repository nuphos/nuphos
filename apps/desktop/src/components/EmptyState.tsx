import { Sparkles } from 'lucide-react'

import { Button } from './ui/button'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  icon: LucideIcon
  title: string
  description: ReactNode
  primaryAction?: { label: string; icon?: LucideIcon; onClick: () => void; disabled?: boolean }
  /** Rendered only when `onOpenAgentChat` is also provided. */
  agentAction?: { label: string; prompt: string }
  onOpenAgentChat?: (prompt: string, options?: { send?: boolean }) => void
}

/**
 * Full-page empty state for a first-level page with no data yet: bare outline
 * icon, the feature's name as title, one or two explanatory sentences, then an
 * optional primary action and an optional hand-off-to-the-agent action.
 * Filtered-empty and secondary states stay on the Table's one-line `empty`
 * prop — this replaces the whole table only when the feature is truly unused.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  agentAction,
  onOpenAgentChat,
}: Props) {
  const PrimaryIcon = primaryAction?.icon
  const showAgent = agentAction && onOpenAgentChat

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon className="h-9 w-9 text-tertiary" strokeWidth={1.5} />
      <div>
        <div className="text-[14px] font-medium text-main">{title}</div>
        <div className="mt-1 max-w-md text-[12.5px] leading-relaxed text-tertiary">
          {description}
        </div>
      </div>
      {(primaryAction ?? showAgent) && (
        <div className="mt-1 flex items-center gap-2">
          {primaryAction && (
            <Button size="sm" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
              {PrimaryIcon && <PrimaryIcon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {primaryAction.label}
            </Button>
          )}
          {showAgent && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenAgentChat(agentAction.prompt, { send: true })}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
              {agentAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
