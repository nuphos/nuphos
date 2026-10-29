import { KeyRound } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { t } from '../../../i18n'
import { agentTier } from '../../../lib/agentName'
import { LocalAgentSignIn } from '../../../views/settings/LocalAgentSignIn'
import { RuntimeLoginDialog } from '../../../views/settings/RuntimeLoginDialog'
import { Button } from '../../ui/button'

import { signInRoute } from './agentSignInModel'
import { ConnectCardContext } from './connectCardContext'

import type { TeamMember } from '../../../types/team'

export function AgentSetupRequiredCard({
  teamId,
  message,
  runtimeId,
  reason,
  details,
  retryText,
  isTeamAdmin = false,
  onOpenAgentSettings,
}: {
  teamId?: string
  runtimeId?: string
  message: string
  reason?: 'reauthentication'
  /** The runtime's own error, kept for support but folded away: the card explains it. */
  details?: string | null
  /** Sent again once the agent is signed in, so nobody retypes it. */
  retryText?: string | null
  isTeamAdmin?: boolean
  onOpenAgentSettings?: () => void
}) {
  const owner = useThisComputer()
  const viewerId = useCurrentUser()?.id
  const { instances } = useRuntimeInstances(teamId)
  const send = useContext(ConnectCardContext)?.send
  const [signingIn, setSigningIn] = useState(false)
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const personalAgent = runtimeId?.startsWith('local_') === true
  const onThisComputer = Boolean(
    runtimeId && personalAgent && agentTier({ id: runtimeId, label: '' }, owner) === 'local',
  )
  const route = signInRoute({
    runtimeId,
    viewerId,
    isTeamAdmin,
    onThisComputer,
    instance: instances.find((instance) => instance.id === runtimeId),
    members,
  })
  const asking = route.kind === 'ask'

  useEffect(() => {
    if (!asking || !teamId) return
    let stopped = false

    void api.atlasListTeamMembers(teamId).then(
      (list) => {
        if (!stopped) setMembers(list)
      },
      () => {},
    )

    return () => {
      stopped = true
    }
  }, [asking, teamId])

  const signedIn = (connected: boolean) => {
    if (connected && retryText && send) send(retryText)
  }

  return (
    <div className="rounded-md border border-zViolet-500/30 bg-zViolet-500/[0.07] px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
        <KeyRound className="h-4 w-4 text-zViolet-400" strokeWidth={1.8} />
        <span>
          {reason === 'reauthentication'
            ? t('Sign in again to continue')
            : t('Connect a runtime to get started')}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-secondary">
        {route.kind === 'none'
          ? message
          : t('This agent needs to be signed in again before it can answer.')}
      </p>
      {route.kind === 'cli' && (
        <LocalAgentSignIn
          provider={route.provider}
          label={t('Sign in again')}
          onClosed={signedIn}
        />
      )}
      {route.kind === 'dialog' && (
        <div>
          <Button size="sm" variant="primary" onClick={() => setSigningIn(true)}>
            {retryText ? t('Sign in and resend') : t('Sign in')}
          </Button>
        </div>
      )}
      {route.kind === 'ask' && (
        <p className="text-[13px] leading-relaxed text-secondary">
          {route.name
            ? t('Ask {name} to sign this agent in, then resend your message.', {
                name: route.name,
              })
            : t('Ask a workspace administrator to reconnect this runtime.')}
        </p>
      )}
      {route.kind === 'none' && personalAgent && !onThisComputer && (
        <p className="text-[13px] leading-relaxed text-secondary">
          {t(
            'Sign in on the computer hosting this runtime, in User settings → Local runtime, then retry your message.',
          )}
        </p>
      )}
      {route.kind === 'none' && !personalAgent && isTeamAdmin && onOpenAgentSettings && (
        <div>
          <Button size="sm" variant="primary" onClick={onOpenAgentSettings}>
            {t('Open runtime settings')}
          </Button>
        </div>
      )}
      {details && (
        <details className="text-[12px] text-tertiary">
          <summary className="cursor-pointer select-none">{t('Details')}</summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono">{details}</p>
        </details>
      )}
      {signingIn && route.kind === 'dialog' && teamId && (
        <RuntimeLoginDialog
          teamId={teamId}
          instance={route.instance}
          onClose={(connected) => {
            setSigningIn(false)
            signedIn(connected)
          }}
        />
      )}
    </div>
  )
}
