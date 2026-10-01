import { parseAtlasError } from '../../api/errors.ts'

import type { PairedExternalRuntime } from '../../types/runtime.ts'
import type { AtlasTeam } from '../../types/team.ts'

export type ConnectAgentTeamChoice = {
  id: string
  name: string
  selectable: boolean
}

export type PairOutcome =
  { kind: 'connected'; runtime: PairedExternalRuntime } | { kind: 'duplicate'; runtimeId: string }

export function connectAgentTeamChoices(teams: readonly AtlasTeam[]): ConnectAgentTeamChoice[] {
  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    selectable: team.role === 'ADMINISTRATOR',
  }))
}

/** The user's pick while it is still selectable; otherwise the current team when they
 *  administer it, else the only team they administer. Recomputed as teams load. */
export function selectedConnectAgentTeam(
  choices: readonly ConnectAgentTeamChoice[],
  chosenTeamId: string,
  currentTeamId?: string,
): string {
  const selectable = choices.filter((choice) => choice.selectable)
  const chosen = selectable.find((choice) => choice.id === chosenTeamId)
  const current = selectable.find((choice) => choice.id === currentTeamId)

  if (chosen) return chosen.id
  if (current) return current.id

  return selectable.length === 1 ? selectable[0].id : ''
}

export function secondsUntil(expiresAt: number | undefined, now: number): number | undefined {
  return expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

export function formatCountdown(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

/** A 409 is a choice for the user, not a failure: the agent already serves this team. */
export async function submitPairing(
  pair: () => Promise<PairedExternalRuntime>,
): Promise<PairOutcome> {
  try {
    return { kind: 'connected', runtime: await pair() }
  } catch (error) {
    const parsed = parseAtlasError(error)
    const runtimeId = (parsed.details as { runtimeId?: unknown } | undefined)?.runtimeId

    if (parsed.code === 'runtime_already_connected' && typeof runtimeId === 'string')
      return { kind: 'duplicate', runtimeId }
    throw error
  }
}
