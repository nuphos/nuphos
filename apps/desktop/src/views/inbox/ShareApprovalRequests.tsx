import clsx from 'clsx'
import { useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { memberDisplayName, useTeamMembers } from '../../lib/bindingAccess'

import { ShareApproveButton } from './ShareApproveButton'

import type { LocalShareApproval, ShareTrustDuration } from '../../api/device-types'

/**
 * Teammates asking to run a conversation on the viewer's own computer. Approving
 * sends the message that waits for it; declining drops it.
 */
export function ShareApprovalRequests({
  teamId,
  approvals,
  decide,
}: {
  teamId: string
  approvals: LocalShareApproval[]
  decide: (
    approval: LocalShareApproval,
    approve: boolean,
    trust?: ShareTrustDuration,
  ) => Promise<void>
}) {
  const members = useTeamMembers(teamId)
  const [deciding, setDeciding] = useState<string | null>(null)

  if (approvals.length === 0) return null
  const nameOf = (userId: string) => {
    const member = members.find((entry) => entry.id === userId)

    return member ? memberDisplayName(member) : t('A teammate')
  }
  const answer = async (
    approval: LocalShareApproval,
    approve: boolean,
    trust?: ShareTrustDuration,
  ) => {
    setDeciding(approval.id)
    try {
      await decide(approval, approve, trust)
    } catch (error) {
      toast.apiError(t('Could not answer this request'), error)
    } finally {
      setDeciding(null)
    }
  }

  return (
    <section className="flex-shrink-0 border-b border-zGray-800/70">
      <div className="px-4 pt-3 pb-1 text-[12px] font-medium text-tertiary">
        {t('Requests to use your computer')}
      </div>
      <ul>
        {approvals.map((approval) => (
          <li
            key={approval.id}
            className={clsx(
              'flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]',
              deciding === approval.id && 'opacity-60',
            )}
          >
            <span className="min-w-0 text-secondary">
              {(approval.title
                ? t(
                    '{name} wants to run {title} on {device}. Their message is sent once you approve.',
                    {
                      device: approval.deviceLabel,
                    },
                  )
                : t(
                    '{name} wants to run a conversation on {device}. Their message is sent once you approve.',
                    { device: approval.deviceLabel },
                  )
              )
                .split(/(\{name\}|\{title\})/)
                .map((part, i) =>
                  part === '{name}' || part === '{title}' ? (
                    <span key={i} className="text-main">
                      {part === '{name}' ? nameOf(approval.actorId) : `“${approval.title}”`}
                    </span>
                  ) : (
                    part
                  ),
                )}
            </span>
            <span className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={deciding !== null}
                onClick={() => void answer(approval, false)}
              >
                {t('Decline')}
              </Button>
              <ShareApproveButton
                disabled={deciding !== null}
                onApprove={(trust) => void answer(approval, true, trust)}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
