import { useRuntimeInstances } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'
import { InstallButton } from '../../views/settings/InstallAgentButton'
import { AgentSignInButton } from '../agent/panel/AgentSignInAction'
import { useAgentSignInRoute } from '../agent/panel/useAgentSignInRoute'
import { useAgentSessions } from '../sidebar/agentSessions'
import { Button } from '../ui/button'

import { replyFix } from './replyFix'

import type { ReplyFailedCause } from './replyFix'

/** What the workspace lends a chat to repair an agent: the viewer's role, and its settings. */
export type ChannelFixes = { isTeamAdmin?: boolean; onOpenAgentSettings?: () => void }

/**
 * The repair on a "couldn't reply" line, taken the way a Task's sign-in card
 * takes it: sign the agent in again and try once more, ask whoever can, or
 * open the runtime settings an administrator keeps.
 */
export function ChannelReplyFix({
  teamId,
  agentId,
  cause,
  fixes,
  onFixed,
}: {
  teamId: string
  agentId: string
  cause: ReplyFailedCause | undefined
  fixes: ChannelFixes
  /** The agent can reply again: retry the post. */
  onFixed: () => void
}) {
  const runtimeId = useAgentSessions(teamId).data?.find(
    (row) => row.sessionId === agentId,
  )?.runtimeId
  const isTeamAdmin = fixes.isTeamAdmin === true
  const { route, personalAgent, onThisComputer } = useAgentSignInRoute({
    teamId,
    runtimeId,
    isTeamAdmin,
  })
  const provider = useRuntimeInstances(teamId).instances.find(
    (instance) => instance.id === runtimeId,
  )?.provider
  const fix = replyFix(cause, route.kind, {
    personalAgent,
    canOpenSettings: isTeamAdmin && Boolean(fixes.onOpenAgentSettings),
    onThisComputer,
  })

  // The installer Settings uses, for the two CLIs Nuphos installs and this line names.
  if (fix === 'install' && (provider === 'claude-code' || provider === 'codex'))
    return <InstallButton provider={provider} />

  if (fix === 'signIn')
    return (
      <AgentSignInButton
        teamId={teamId}
        route={route}
        label={t('Sign in again')}
        onSignedIn={(connected) => connected && onFixed()}
      />
    )
  if (fix === 'ask' && route.kind === 'ask')
    return (
      <span className="text-[12px] text-tertiary">
        {route.name
          ? t('Ask {name} to sign this runtime in.', { name: route.name })
          : t('Ask a team administrator to reconnect this runtime.')}
      </span>
    )
  if (fix === 'settings')
    return (
      <Button size="sm" variant="primary" onClick={fixes.onOpenAgentSettings}>
        {t('Open runtime settings')}
      </Button>
    )

  return null
}
