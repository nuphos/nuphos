import { useContext } from 'react'

import { ConnectCardContext } from './connectCardContext'
import { personalConnectStatus } from './connectCardModel'
import { ConnectHeader, ConnectRow } from './ConnectCardRows'
import { setPersonalOnly } from './personalIdentity'

import type { ConnectRowStatus } from './connectCardModel'
import type { PersonalCredentialProvider } from '../../../types'

/**
 * The Connect card of a question naming the member's own credentials: only
 * selecting one in this conversation answers it, never a team binding. One not
 * connected yet is connected in Connectors, not here.
 */
export function PersonalConnectCard({
  toolCallId,
  teamId,
  providers,
  reason,
  canAct,
}: {
  toolCallId: string
  teamId?: string
  providers: PersonalCredentialProvider[]
  reason: string
  /** The latest reply and no turn running: only then can the card act. */
  canAct: boolean
}) {
  const credentials = useContext(ConnectCardContext)?.credentials
  const interactive = Boolean(credentials && teamId && canAct)
  const statusOf = (provider: PersonalCredentialProvider): ConnectRowStatus =>
    credentials
      ? personalConnectStatus(provider, credentials.value, credentials.options.personalCredentials)
      : 'idle'

  return (
    <div
      data-tool-call-id={toolCallId}
      data-decision-question={reason || undefined}
      className="overflow-hidden rounded-xl surface-raised bg-surface-raised"
    >
      <ConnectHeader providers={providers} reason={reason} />
      <ul>
        {providers.map((provider) => {
          const status = statusOf(provider)

          return (
            <ConnectRow
              key={provider}
              provider={provider}
              status={status}
              interactive={interactive && status !== 'idle'}
              onUse={() =>
                credentials?.onChange(setPersonalOnly(credentials.value, provider, true))
              }
            />
          )
        })}
      </ul>
    </div>
  )
}
