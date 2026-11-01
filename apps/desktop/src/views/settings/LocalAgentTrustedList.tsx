import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { LocalShareTrust } from '../../api/device-types'

const until = (expiresAt: string) =>
  new Date(expiresAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/**
 * Teammates the owner trusts on this computer: their conversations run without asking
 * until the trust ends. Hidden when there are none, or the backend does not know trusts yet.
 */
export function LocalAgentTrustedList({
  teamId,
  deviceId,
  nameOf,
  version,
}: {
  teamId: string
  deviceId: string
  nameOf: (userId: string) => string
  /** Bumped after approving with trust, so the list reads again. */
  version: number
}) {
  const [trusts, setTrusts] = useState<LocalShareTrust[]>([])
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    let live = true

    void api
      .localShareTrusts(deviceId, teamId)
      .then((next) => {
        if (live) setTrusts(next)
      })
      .catch(() => {
        if (live) setTrusts([])
      })

    return () => {
      live = false
    }
  }, [deviceId, teamId, version])

  if (trusts.length === 0) return null
  const stop = async (actorId: string) => {
    setRemoving(actorId)
    try {
      await api.localShareUntrust(deviceId, teamId, actorId)
      setTrusts((previous) => previous.filter((trust) => trust.actorId !== actorId))
    } catch (error) {
      toast.apiError(t('Could not stop trusting this teammate'), error)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="border-t border-zGray-800/60">
      <div className="px-4 pt-3 pb-1 text-[12px] font-medium text-tertiary">
        {t('Trusted on this computer')}
      </div>
      <ul>
        {trusts.map((trust) => (
          <li
            key={trust.actorId}
            className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px]"
          >
            <span className="min-w-0 truncate text-secondary">
              <span className="text-main">{nameOf(trust.actorId)}</span>
              {' · '}
              {trust.expiresAt ? t('Until {time}', { time: until(trust.expiresAt) }) : t('Always')}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={removing !== null}
              onClick={() => void stop(trust.actorId)}
            >
              {t('Stop trusting')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
