import { useContext, useRef, useState } from 'react'

import { api } from '../../../api'
import { TeamHomeBindFlow } from '../../../views/cloud/team-home-bind-flow'

import { ConnectCardContext } from './connectCardContext'
import {
  CONNECT_SELECTION_KEY,
  connectRowStatus,
  newConnectIds,
  parseConnectRequest,
  withConnectIds,
} from './connectCardModel'
import { ConnectHeader, ConnectRow, ContinueFooter } from './ConnectCardRows'
import { allCredentialAccess, normalizeCredentialOptions } from './credentialAccess'
import { ToolPartView } from './ToolPartView'

import type { ConnectPhase, ConnectProvider, ConnectRowStatus } from './connectCardModel'
import type { CredentialSelectorControl } from './credentialSections'
import type { ToolPart } from './parts'
import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'
import type { TeamHomeBindFlowHandle } from '../../../views/cloud/team-home-bind-flow'

// Codex polls the link this way before treating a connect as failed: a bind can
// land a beat before the credential list shows it.
const CONFIRM_DELAYS_MS = [0, 500, 1000, 2000]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function boundAfterConnect(
  teamId: string,
  provider: ConnectProvider,
  before: AgentCredentialSelection,
): Promise<{ options: AgentCredentialOptions; ids: string[] } | null> {
  let last: AgentCredentialOptions | null = null

  for (const delay of CONFIRM_DELAYS_MS) {
    await wait(delay)
    last = normalizeCredentialOptions(await api.agentGetCredentialOptions(teamId))
    const ids = newConnectIds(provider, before, allCredentialAccess(last))

    if (ids.length > 0) return { options: last, ids }
  }
  // Reconnecting an account the team already had adds no new id; select it.
  const existing = last ? allCredentialAccess(last)[CONNECT_SELECTION_KEY[provider]] : []

  return last && existing.length > 0 ? { options: last, ids: existing } : null
}

type Fresh = { forOptions: AgentCredentialOptions; options: AgentCredentialOptions }

// The newest bound credentials: options fetched right after a bind, until the
// panel's own copy refreshes past them.
function currentAvailable(
  credentials: CredentialSelectorControl | undefined,
  fresh: Fresh | null,
): AgentCredentialSelection | undefined {
  if (!credentials) return undefined

  return allCredentialAccess(
    fresh?.forOptions === credentials.options ? fresh.options : credentials.options,
  )
}

export function ConnectCard({
  teamId,
  providers,
  reason,
}: {
  teamId?: string
  providers: ConnectProvider[]
  reason: string
}) {
  const ctx = useContext(ConnectCardContext)
  const credentials = ctx?.credentials
  const [phases, setPhases] = useState<Partial<Record<ConnectProvider, ConnectPhase>>>({})
  // Options fetched right after a bind, used until the panel's own copy refreshes.
  const [fresh, setFresh] = useState<Fresh | null>(null)
  const [continued, setContinued] = useState(false)
  const bindFlowRef = useRef<TeamHomeBindFlowHandle>(null)
  const activeRef = useRef<{ provider: ConnectProvider; before: AgentCredentialSelection } | null>(
    null,
  )
  const boundRef = useRef(false)
  const interactive = Boolean(credentials && teamId)
  const available = currentAvailable(credentials, fresh)
  const setPhase = (provider: ConnectProvider, phase: ConnectPhase) =>
    setPhases((prev) => ({ ...prev, [provider]: phase }))
  const statusOf = (provider: ConnectProvider): ConnectRowStatus =>
    credentials && available
      ? connectRowStatus(provider, phases[provider] ?? 'idle', credentials.value, available)
      : 'idle'
  const anyConnected = providers.some((provider) => statusOf(provider) === 'connected')

  function connect(provider: ConnectProvider) {
    if (!credentials || !available) return
    activeRef.current = { provider, before: available }
    boundRef.current = false
    setPhase(provider, 'connecting')
    bindFlowRef.current?.openIntegration(provider)
  }

  function onBound() {
    const active = activeRef.current

    if (!active || !teamId || !credentials) return
    boundRef.current = true
    void boundAfterConnect(teamId, active.provider, active.before)
      .then((found) => {
        if (!found) {
          setPhase(active.provider, 'error')

          return
        }
        setFresh({ forOptions: credentials.options, options: found.options })
        credentials.onChange(withConnectIds(credentials.value, active.provider, found.ids))
        setPhase(active.provider, 'idle')
      })
      .catch(() => setPhase(active.provider, 'error'))
  }

  function onDialogsClosed() {
    const active = activeRef.current

    activeRef.current = null
    if (active && !boundRef.current) setPhase(active.provider, 'cancelled')
  }

  function use(provider: ConnectProvider) {
    if (!credentials || !available) return
    const ids = available[CONNECT_SELECTION_KEY[provider]]

    credentials.onChange(withConnectIds(credentials.value, provider, ids))
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-875">
      <ConnectHeader providers={providers} reason={reason} />
      <ul>
        {providers.map((provider) => (
          <ConnectRow
            key={provider}
            provider={provider}
            status={statusOf(provider)}
            interactive={interactive}
            onConnect={() => connect(provider)}
            onUse={() => use(provider)}
          />
        ))}
      </ul>
      {interactive && anyConnected && !continued && (
        <ContinueFooter
          onContinue={() => {
            setContinued(true)
            ctx?.send('continue')
          }}
        />
      )}
      {interactive && teamId && (
        <TeamHomeBindFlow
          ref={bindFlowRef}
          teamId={teamId}
          addIntegrationOpen={false}
          onOpenAgentChat={(prompt) => ctx?.send(prompt)}
          onChanged={onBound}
          onDialogsClosed={onDialogsClosed}
        />
      )}
    </div>
  )
}

/** `request_connection`: its card once the input parses, else the plain tool row. */
export function ConnectToolPart({
  part,
  now,
  teamId,
}: {
  part: ToolPart
  now: number
  teamId?: string
}) {
  const request = part.state === 'output-error' ? null : parseConnectRequest(part.input)

  if (!request) return <ToolPartView part={part} now={now} />

  return <ConnectCard teamId={teamId} providers={request.providers} reason={request.reason} />
}
