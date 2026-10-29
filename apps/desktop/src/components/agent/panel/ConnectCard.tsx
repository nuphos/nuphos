import { useContext, useRef, useState } from 'react'

import { api } from '../../../api'
import { TeamHomeBindFlow } from '../../../views/cloud/team-home-bind-flow'

import { ChoiceCard } from './ChoiceCard'
import { ConnectCardContext } from './connectCardContext'
import {
  CONNECT_SELECTION_KEY,
  connectRowStatus,
  newConnectIds,
  parseChoiceRequest,
  parseConnectRequest,
  parseSecretRequest,
  withConnectIds,
} from './connectCardModel'
import { ConnectHeader, ConnectRow, ContinueFooter } from './ConnectCardRows'
import { allCredentialAccess, normalizeCredentialOptions } from './credentialAccess'
import { SecretCard } from './SecretCard'
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

    // Select only an unambiguous result; with several (a teammate bound one in
    // the same window) the row asks the user to pick in the credential picker.
    if (ids.length > 0) return { options: last, ids: ids.length === 1 ? ids : [] }
  }
  // Reconnecting an account the team already had adds no new id; select it if it is the only one.
  const existing = last ? allCredentialAccess(last)[CONNECT_SELECTION_KEY[provider]] : []

  return last && existing.length > 0
    ? { options: last, ids: existing.length === 1 ? existing : [] }
    : null
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
  canAct,
}: {
  teamId?: string
  providers: ConnectProvider[]
  reason: string
  /** The latest reply and no turn running: only then can the card act or resume. */
  canAct: boolean
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
  const interactive = Boolean(credentials && teamId && canAct)
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
        if (found.ids.length > 0) {
          credentials.onChange(withConnectIds(credentials.value, active.provider, found.ids))
        }
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

    if (ids.length === 1) credentials.onChange(withConnectIds(credentials.value, provider, ids))
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
          onChanged={onBound}
          onDialogsClosed={onDialogsClosed}
        />
      )}
    </div>
  )
}

/** A user decision: a Connect card when it lists `providers`, a secure input card when it names a `secretName`, else its question card; the plain tool row until the input parses. */
export function DecisionToolPart({
  part,
  now,
  teamId,
  canAct,
}: {
  part: ToolPart
  now: number
  teamId?: string
  canAct: boolean
}) {
  const failed = part.state === 'output-error'
  const connect = failed ? null : parseConnectRequest(part.input)
  const secret = failed || connect ? null : parseSecretRequest(part.input)
  const choice = failed || connect || secret ? null : parseChoiceRequest(part.input)

  if (connect) {
    return (
      <ConnectCard
        teamId={teamId}
        providers={connect.providers}
        reason={connect.reason}
        canAct={canAct}
      />
    )
  }
  if (secret) return <SecretCard {...secret} canAct={canAct} />
  if (choice) return <ChoiceCard {...choice} canAct={canAct} />

  return <ToolPartView part={part} now={now} />
}
