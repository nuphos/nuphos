import { KeyRound } from 'lucide-react'

import { useThisComputer } from '../../../hooks/useThisComputer'
import { agentTier } from '../../../lib/agentName'
import { LocalClaudeSignIn } from '../../../views/settings/LocalClaudeSignIn'
import { Button } from '../../ui/button'

export function AgentSetupRequiredCard({
  message,
  runtimeId,
  reason,
  isTeamAdmin,
  onOpenAgentSettings,
}: {
  runtimeId?: string
  message: string
  reason?: 'reauthentication'
  isTeamAdmin?: boolean
  onOpenAgentSettings?: () => void
}) {
  const owner = useThisComputer()
  const personalAgent = runtimeId?.startsWith('local_') === true
  const localClaude =
    runtimeId &&
    !runtimeId.endsWith('_codex') &&
    agentTier({ id: runtimeId, label: '' }, owner) === 'local'

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
      {localClaude && <LocalClaudeSignIn label="Sign in again with Claude" />}
      {personalAgent && !localClaude && (
        <p className="text-[13px] leading-relaxed text-secondary">
          Sign in on the computer hosting this agent, in User settings → Local agent, then retry
          your message.
        </p>
      )}
      {reason === 'reauthentication' && !isTeamAdmin && !personalAgent && (
        <p className="text-[13px] leading-relaxed text-secondary">
          Ask a workspace administrator to reconnect this agent.
        </p>
      )}
      {!localClaude && isTeamAdmin && onOpenAgentSettings && (
        <div>
          <Button size="sm" variant="primary" onClick={onOpenAgentSettings}>
            Open Agent settings
          </Button>
        </div>
      )}
    </div>
  )
}
