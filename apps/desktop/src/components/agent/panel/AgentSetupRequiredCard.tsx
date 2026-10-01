import { KeyRound } from 'lucide-react'

import { Button } from '../../ui/button'

export function AgentSetupRequiredCard({
  message,
  reason,
  isTeamAdmin,
  onOpenAgentSettings,
}: {
  message: string
  reason?: 'reauthentication'
  isTeamAdmin?: boolean
  onOpenAgentSettings?: () => void
}) {
  return (
    <div className="rounded-md border border-zViolet-500/30 bg-zViolet-500/[0.07] px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
        <KeyRound className="h-4 w-4 text-zViolet-400" strokeWidth={1.8} />
        <span>
          {reason === 'reauthentication'
            ? 'Sign in again to continue'
            : 'Connect an agent to get started'}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-secondary">{message}</p>
      {reason === 'reauthentication' && !isTeamAdmin && (
        <p className="text-[13px] leading-relaxed text-secondary">
          Ask a workspace administrator to reconnect this agent.
        </p>
      )}
      {isTeamAdmin && onOpenAgentSettings && (
        <div>
          <Button size="sm" variant="primary" onClick={onOpenAgentSettings}>
            Open Agent settings
          </Button>
        </div>
      )}
    </div>
  )
}
