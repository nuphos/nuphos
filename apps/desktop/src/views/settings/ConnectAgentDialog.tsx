import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { AppSelect } from '../../components/ui/select'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { agentHost } from '../../lib/connectAgentLink'

import {
  connectAgentTeamChoices,
  formatCountdown,
  secondsUntil,
  selectedConnectAgentTeam,
  submitPairing,
} from './connectAgent'
import { Field } from './shared'
import { inputClasses } from './styles'

import type { ConnectAgentLink } from '../../lib/connectAgentLink'
import type { AtlasTeam } from '../../types'

const primaryButton =
  'inline-flex items-center gap-2 rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:opacity-50'

function useSecondsLeft(expiresAt: number | undefined): number | undefined {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)

    return () => clearInterval(timer)
  }, [expiresAt])

  return secondsUntil(expiresAt, now)
}

/** Opened by the agent console's "Connect to Nuphos" link. Nothing leaves Desktop before Confirm. */
export function ConnectAgentDialog({
  link,
  teams,
  currentTeamId,
  onClose,
  onConnected,
}: {
  link: ConnectAgentLink
  teams: readonly AtlasTeam[]
  currentTeamId?: string
  onClose: () => void
  onConnected: (teamId: string) => void
}) {
  const choices = useMemo(() => connectAgentTeamChoices(teams), [teams])
  const [chosenTeamId, setChosenTeamId] = useState('')
  const teamId = selectedConnectAgentTeam(choices, chosenTeamId, currentTeamId)
  const [label, setLabel] = useState(() => new URL(link.url).hostname.slice(0, 120))
  const [saving, setSaving] = useState(false)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const secondsLeft = useSecondsLeft(link.expiresAt)
  const expired = secondsLeft === 0
  const team = teams.find((candidate) => candidate.id === teamId)
  const teamsLoading = teams.length === 0
  const noAdminTeam = !teamsLoading && choices.every((choice) => !choice.selectable)

  async function confirm(replaceRuntimeId?: string) {
    if (!team || expired || saving) return
    setSaving(true)
    try {
      const outcome = await submitPairing(() =>
        api.atlasPairExternalRuntime(team.id, {
          url: link.url,
          code: link.code,
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(replaceRuntimeId ? { replaceRuntimeId } : {}),
        }),
      )

      if (outcome.kind === 'duplicate') {
        setDuplicateId(outcome.runtimeId)

        return
      }
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
      toast.success(
        outcome.runtime.replaced ? 'Agent connection updated' : 'Agent connected',
        `${outcome.runtime.label ?? label} is now available in ${team.name}.`,
      )
      onConnected(team.id)
    } catch (error) {
      toast.apiError('Could not connect agent', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Connect this agent to a team"
      description="The agent’s console sent this request. Check the address before you confirm."
      closeOnBackdrop={false}
    >
      <div className="space-y-4 p-5">
        <div className="rounded-lg border border-zGray-800 bg-zGray-800/30 px-4 py-3">
          <p className="text-[15px] font-semibold text-main">{agentHost(link.url)}</p>
          <p className="mt-0.5 break-all font-mono text-[12px] text-tertiary">{link.url}</p>
        </div>
        {teamsLoading ? (
          <p className="flex items-center gap-2 text-[13px] text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading your teams…
          </p>
        ) : noAdminTeam ? (
          <p className="text-[13px] leading-5 text-secondary">
            Only workspace administrators can connect agents, and you are not an administrator of
            any workspace. Ask an administrator to open the link from the agent console.
          </p>
        ) : (
          <>
            <Field label="Team">
              <AppSelect
                ariaLabel="Team"
                value={teamId}
                placeholder="Choose a team"
                onValueChange={(value) => {
                  setChosenTeamId(value)
                  setDuplicateId(null)
                }}
                disabled={saving}
                options={choices.map((choice) => ({
                  value: choice.id,
                  label: choice.name,
                  disabled: !choice.selectable,
                  ...(choice.selectable ? {} : { description: 'Administrators only' }),
                }))}
              />
            </Field>
            <Field label="Name" hint="How this agent appears in the team’s agent list.">
              <input
                aria-label="Name"
                className={inputClasses}
                value={label}
                maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
                disabled={saving}
              />
            </Field>
          </>
        )}
        {duplicateId && team && (
          <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
            This agent is already connected to {team.name}. Updating the existing connection gives
            it a new key and keeps its conversations.
          </p>
        )}
        <p className="text-[12px] text-tertiary" role="status">
          {expired
            ? 'This pairing code has expired. Generate a new one in the agent console.'
            : secondsLeft !== undefined
              ? `The pairing code expires in ${formatCountdown(secondsLeft)}.`
              : 'The pairing code works once and expires after a few minutes.'}
        </p>
        <div className="flex items-center gap-2">
          {duplicateId ? (
            <button
              type="button"
              className={primaryButton}
              disabled={saving || expired}
              onClick={() => void confirm(duplicateId)}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Update existing connection
            </button>
          ) : (
            <button
              type="button"
              className={primaryButton}
              disabled={saving || expired || !team || noAdminTeam}
              onClick={() => void confirm()}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Connect agent
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
