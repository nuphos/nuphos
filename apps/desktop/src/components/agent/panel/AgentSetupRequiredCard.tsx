import { KeyRound } from 'lucide-react'
import { useContext, useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { AgentSignInButton } from './AgentSignInAction'
import { askState } from './agentSignInModel'
import { useAgentSignInRoute } from './useAgentSignInRoute'
import { ConnectCardContext } from './connectCardContext'
import { rememberSignInAsk } from './signInAsks'

import type { Message } from './model'
import type { AgentSignInRequest } from '../../../api/agent-types'

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
  const viewerId = useCurrentUser()?.id
  const send = useContext(ConnectCardContext)?.send
  const [sending, setSending] = useState(false)
  const [signedInHere, setSignedInHere] = useState(false)
  const { route, personalAgent, onThisComputer } = useAgentSignInRoute({
    teamId,
    runtimeId,
    isTeamAdmin,
  })
  const ask = askState(signInRequest, viewerId, messages)
  const failed = message !== undefined
  const canAsk = Boolean(teamId && sessionId && retryText)

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
    <div className="rounded-md border border-action-primary/30 bg-action-primary/[0.07] px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
        <KeyRound className="h-4 w-4 text-secondary" strokeWidth={1.8} />
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
        <AgentSignInButton
          teamId={teamId}
          route={route}
          label={t('Sign in again')}
          onSignedIn={signedIn}
        />
      )}
      {route.kind === 'dialog' && (
        <div>
          <AgentSignInButton
            teamId={teamId}
            route={route}
            label={retryText ? t('Sign in and resend') : t('Sign in')}
            onSignedIn={signedIn}
          />
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
            'Sign in on the computer hosting this runtime, in Settings → Local runtime, then retry your message.',
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
    </div>
  )
}
