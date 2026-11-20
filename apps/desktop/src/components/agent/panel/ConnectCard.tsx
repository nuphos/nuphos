import { useContext, useRef, useState } from 'react'

import { api } from '../../../api'
import { useTeamRole } from '../../../hooks/useTeamRole'
import { TeamHomeBindFlow } from '../../../views/cloud/team-home-bind-flow'

import { ConnectCardContext } from './connectCardContext'
import {
  CONNECT_SELECTION_KEY,
  connectBlock,
  connectRowStatus,
  newConnectIds,
  personalConnectStatus,
  withConnectIds,
} from './connectCardModel'
import { ConnectHeader, ConnectRow } from './ConnectCardRows'
import { allCredentialAccess, normalizeCredentialOptions } from './credentialAccess'
import { setPersonalOnly } from './personalIdentity'

import type { ConnectPhase, ConnectProvider, ConnectRowStatus } from './connectCardModel'
import type { CredentialSelectorControl } from './credentialSections'
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
  toolCallId,
  teamId,
  providers,
  reason,
  personal = false,
  canAct,
}: {
  toolCallId: string
  teamId?: string
  providers: ConnectProvider[]
  reason: string
  /** It asks for the member's own credential: only selecting that answers it, never a team binding. */
  personal?: boolean
  /** The latest reply and no turn running: only then can the card act. */
  canAct: boolean
}) {
  const ctx = useContext(ConnectCardContext)
  const credentials = ctx?.credentials
  // Binding a team's connector takes an administrator. Read here rather than
  // threaded from every surface that draws a card: a surface that forgot it
  // told administrators to ask an administrator. Unknown while they load.
  const role = useTeamRole(teamId)
  const canBindTeam = role === undefined ? undefined : role === 'ADMINISTRATOR'
  const [phases, setPhases] = useState<Partial<Record<ConnectProvider, ConnectPhase>>>({})
  // Options fetched right after a bind, used until the panel's own copy refreshes.
  const [fresh, setFresh] = useState<Fresh | null>(null)
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
    personal && credentials && (provider === 'github' || provider === 'linear')
      ? personalConnectStatus(
          provider,
          credentials.value,
          credentials.options.personalCredentials ?? [],
        )
      : credentials && available
        ? connectRowStatus(provider, phases[provider] ?? 'idle', credentials.value, available)
        : 'idle'

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
    if (personal && credentials && (provider === 'github' || provider === 'linear')) {
      credentials.onChange(setPersonalOnly(credentials.value, provider, true))

      return
    }
    if (!credentials || !available) return
    const ids = available[CONNECT_SELECTION_KEY[provider]]

    if (ids.length === 1) credentials.onChange(withConnectIds(credentials.value, provider, ids))
  }

  return (
    <div
      data-tool-call-id={toolCallId}
      data-decision-question={reason || undefined}
      className="overflow-hidden rounded-xl surface-raised bg-surface-raised"
    >
      <ConnectHeader providers={providers} reason={reason} />
      <ul>
        {providers.map((provider) => (
          <ConnectRow
            key={provider}
            provider={provider}
            status={statusOf(provider)}
            // Connecting your own credential lives in Settings, not a team bind.
            interactive={interactive && !(personal && statusOf(provider) === 'idle')}
            blocked={
              personal || canBindTeam === undefined
                ? undefined
                : connectBlock(provider, canBindTeam)
            }
            onConnect={() => connect(provider)}
            onUse={() => use(provider)}
          />
        ))}
      </ul>
      {interactive && teamId && !personal && (
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
