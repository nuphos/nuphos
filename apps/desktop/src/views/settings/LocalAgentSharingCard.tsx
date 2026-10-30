import clsx from 'clsx'
import { Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import { LOCAL_AGENT_CARD } from './LocalAgentCard'
import { LocalAgentShareDialog } from './LocalAgentShareDialog'
import { effectiveShare, shareSummary } from './localAgentSharingPresentation'

import type { LocalAgentShareState, LocalShareApproval } from '../../api/device-types'

const APPROVAL_POLL_MS = 10_000

/**
 * Sharing the person's own computer's local runtime with teammates in the current team,
 * and the agents of theirs waiting for this person's approval before they run there.
 * Shown on the Computers page under that computer; its menu opens the same dialog.
 */
export function LocalAgentSharingCard({
  teamId,
  currentUserId,
  device,
  editing,
  onEditingChange,
  onShareableChange,
}: {
  teamId: string
  currentUserId: string
  device: { deviceId: string; label: string }
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** Whether there is anything to change: false when administrators turned sharing off and it is not shared. */
  onShareableChange?: (shareable: boolean) => void
}) {
  const [state, setState] = useState<LocalAgentShareState | null>(null)
  const [approvals, setApprovals] = useState<LocalShareApproval[]>([])
  const [deciding, setDeciding] = useState<string | null>(null)
  const members = useTeamMembers(teamId)

  useEffect(() => {
    const live = { current: true }

    void api
      .localShareGet(device.deviceId, teamId)
      .then((next) => {
        if (live.current) setState(next)
      })
      .catch(() => null)

    return () => {
      live.current = false
    }
  }, [device.deviceId, teamId])

  const shareable = state ? !(state.ceiling === 'off' && state.share.level === 'off') : false

  useEffect(() => {
    onShareableChange?.(shareable)
  }, [shareable, onShareableChange])

  const loadApprovals = useCallback(async () => {
    setApprovals(await api.localShareApprovals(teamId).catch(() => []))
  }, [teamId])

  useEffect(() => {
    // A full share under an `approve` ceiling still asks, so poll whenever it is shared.
    if (!state || state.share.level === 'off') return
    queueMicrotask(() => void loadApprovals())
    const timer = setInterval(() => void loadApprovals(), APPROVAL_POLL_MS)

    return () => clearInterval(timer)
  }, [state, loadApprovals])

  const decide = async (approval: LocalShareApproval, approve: boolean) => {
    setDeciding(approval.id)
    try {
      await api.localShareDecide(approval.id, approve)
      setApprovals((previous) => previous.filter((entry) => entry.id !== approval.id))
    } catch (error) {
      toast.apiError(t('Could not answer this request'), error)
    } finally {
      setDeciding(null)
    }
  }

  if (!state) return null
  // Everyone but the viewer, once the members have loaded.
  const teammates = members.length > 0 ? members.length - 1 : undefined
  const nameOf = (userId: string) => {
    const member = members.find((entry) => entry.id === userId)

    return member ? memberDisplayName(member) : t('A teammate')
  }

  return (
    <div className={LOCAL_AGENT_CARD}>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-main">
            {t('Share {device} with teammates', { device: device.label })}
          </div>
          <div className="mt-0.5 text-[12px] text-tertiary">
            {state.ceiling === 'off'
              ? t('Your team’s administrators have turned off sharing your own computer.')
              : shareSummary(effectiveShare(state.share, state.ceiling), teammates)}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!shareable}
          onClick={() => onEditingChange(true)}
        >
          <Users strokeWidth={1.5} className="mr-1.5 h-3.5 w-3.5" />
          {state.share.level === 'off' ? t('Share') : t('Change')}
        </Button>
      </div>
      {approvals.length > 0 && (
        <ul className="border-t border-zGray-800/60">
          {approvals.map((approval) => {
            // The name is styled, so split one sentence around it.
            const request = t('{name} wants to run an agent on {device}', {
              device: approval.deviceLabel,
            }).split('{name}')

            return (
              <li
                key={approval.id}
                className={clsx(
                  'flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]',
                  deciding === approval.id && 'opacity-60',
                )}
              >
                <span className="min-w-0 truncate text-secondary">
                  {request[0]}
                  <span className="text-main">{nameOf(approval.actorId)}</span>
                  {request[1]}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={deciding !== null}
                    onClick={() => void decide(approval, false)}
                  >
                    {t('Decline')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={deciding !== null}
                    onClick={() => void decide(approval, true)}
                  >
                    {t('Approve')}
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {editing && shareable && (
        <LocalAgentShareDialog
          teamId={teamId}
          deviceId={device.deviceId}
          deviceLabel={device.label}
          currentUserId={currentUserId}
          state={state}
          onClose={() => onEditingChange(false)}
          onSaved={setState}
        />
      )}
    </div>
  )
}
