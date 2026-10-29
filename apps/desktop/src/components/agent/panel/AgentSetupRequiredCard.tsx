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
import { toast } from '../../ui/toast'

import { askState, signInRoute } from './agentSignInModel'
import { ConnectCardContext } from './connectCardContext'
import { rememberSignInAsk } from './signInAsks'

import type { Message } from './model'
import type { AgentSignInRequest } from '../../../api/agent-types'
import type { TeamMember } from '../../../types/team'

export function AgentSetupRequiredCard({
  teamId,
  sessionId,
  message,
  runtimeId,
  reason,
  details,
  retryText,
  signInRequest,
  messages = [],
  isTeamAdmin = false,
  onOpenAgentSettings,
}: {
  teamId?: string
  sessionId?: string
  runtimeId?: string
  /** This viewer's own turn failed with it; absent when shown only for an ask. */
  message?: string
  reason?: 'reauthentication'
  /** The runtime's own error, kept for support but folded away: the card explains it. */
  details?: string | null
  /** Sent again once the agent is signed in, so nobody retypes it. */
  retryText?: string | null
  /** Someone asked who can sign this agent in; the people asked see the card from it alone. */
  signInRequest?: AgentSignInRequest
  messages?: Message[]
  isTeamAdmin?: boolean
  onOpenAgentSettings?: () => void
}) {
  const owner = useThisComputer()
  const viewerId = useCurrentUser()?.id
  const { instances } = useRuntimeInstances(teamId)
  const send = useContext(ConnectCardContext)?.send
  const [signingIn, setSigningIn] = useState(false)
  const [sending, setSending] = useState(false)
  const [signedInHere, setSignedInHere] = useState(false)
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
  const asksSomeone = route.kind === 'ask'
  const ask = askState(signInRequest, viewerId, messages)
  const failed = message !== undefined
  const canAsk = Boolean(teamId && sessionId && retryText)

  useEffect(() => {
    if (!asksSomeone || !teamId) return
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
  }, [asksSomeone, teamId])

  // Without a failed turn of the viewer's own, the card is about an open ask.
  if (!failed && (!ask || signedInHere)) return null

  const signedIn = (connected: boolean) => {
    if (!connected) return
    setSignedInHere(true)
    if (retryText && send) send(retryText)
    // A runtime sign-in settles the ask itself; this computer's CLI sign-in is not seen by it.
    if (ask === 'asked' && route.kind === 'cli' && teamId && runtimeId)
      void api.runtimeSignInSettle(teamId, runtimeId).catch(() => {})
  }
  const askToSignIn = async () => {
    if (!teamId || !runtimeId || !sessionId) return
    setSending(true)
    try {
      const { askedName } = await api.runtimeSignInAsk(teamId, runtimeId, sessionId)

      rememberSignInAsk(sessionId, {
        runtimeId,
        requesterId: viewerId ?? '',
        requesterName: '',
        askedUserIds: [],
        askedName,
        askedAt: new Date().toISOString(),
      })
      // The server holds it until they sign in, then runs it as this viewer's message.
      if (retryText && send) send(retryText)
    } catch (error) {
      toast.apiError(t('Could not send the request'), error)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-md border border-zViolet-500/30 bg-zViolet-500/[0.07] px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
        <KeyRound className="h-4 w-4 text-zViolet-400" strokeWidth={1.8} />
        <span>
          {reason === 'reauthentication' || !failed
            ? t('Sign in again to continue')
            : t('Connect a runtime to get started')}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-secondary">
        {ask === 'asked' && signInRequest
          ? t('{name} asked you to sign this agent in. Their message runs once you do.', {
              name: signInRequest.requesterName,
            })
          : route.kind === 'none'
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
      {route.kind === 'ask' && ask === 'requester' && signInRequest && (
        <p className="text-[13px] leading-relaxed text-secondary">
          {t('Asked {name}. Your message will run once they sign in.', {
            name: signInRequest.askedName,
          })}
        </p>
      )}
      {route.kind === 'ask' && ask !== 'requester' && canAsk && (
        <div>
          <Button size="sm" variant="primary" disabled={sending} onClick={() => void askToSignIn()}>
            {route.name ? t('Ask {name} to sign in', { name: route.name }) : t('Ask to sign in')}
          </Button>
        </div>
      )}
      {route.kind === 'ask' && ask !== 'requester' && !canAsk && (
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
