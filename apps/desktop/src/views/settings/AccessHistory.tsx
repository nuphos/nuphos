import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'
import { memberDisplayName } from '../../lib/bindingAccess'
import { useTeamMemberList } from '../../hooks/useTeamMemberList'

import { describeAccessChange, viaLabel } from './accessChanges'

import type { AccessChange } from '../../api/device-access-types'

/**
 * Who changed who may use or manage this computer here, newest first. Loaded only when opened:
 * it is for owners and managers, who are the ones who can open the dialog it sits in.
 */
export function AccessHistory({ deviceId, teamId }: { deviceId: string; teamId: string }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<AccessChange[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  // Read with the dialog, not on open, so names are there by the time the history is.
  const members = useTeamMemberList(teamId)
  const name = (id: string) => {
    const member = members?.find((one) => one.id === id)

    return member ? memberDisplayName(member) : t('A former member')
  }
  const load = (before?: string) => {
    setState('loading')
    api
      .deviceAccessHistory(deviceId, teamId, before)
      .then((page) => {
        setEntries((current) => [...(before ? (current ?? []) : []), ...page.entries])
        setCursor(page.nextCursor)
        setState('idle')
      })
      .catch(() => setState('failed'))
  }
  const toggle = () => {
    if (!open && entries === null) load()
    setOpen(!open)
  }

  return (
    <div className="rounded-xl border border-line-control">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[12.5px] text-main"
      >
        <ChevronRight
          className={
            open ? 'h-3.5 w-3.5 rotate-90 transition-transform' : 'h-3.5 w-3.5 transition-transform'
          }
          strokeWidth={2}
        />
        {t('Access history')}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line-control px-3 py-2.5">
          {entries?.length === 0 && (
            <p className="text-[12px] text-tertiary">{t('No changes to who can use it yet.')}</p>
          )}
          <ul className="max-h-56 space-y-2 overflow-y-auto">
            {entries?.map((change) => {
              const via = viaLabel(change.via)

              return (
                <li key={change.id ?? change.changedAt} className="text-[12px] leading-snug">
                  <div className="text-tertiary">
                    {t('{name} · {when}', {
                      name: name(change.actorUserId),
                      when: relativeTimeFromNow(change.changedAt),
                    })}
                    {via ? ` · ${via}` : ''}
                  </div>
                  {describeAccessChange(change, name).map((line, index) => (
                    <div key={index} className="text-main">
                      {line}
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
          {state === 'failed' && (
            <p className="text-[12px] text-error">{t('Couldn’t load the access history.')}</p>
          )}
          {(cursor || state === 'failed') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={state === 'loading'}
              onClick={() =>
                load(state === 'failed' && !cursor ? undefined : (cursor ?? undefined))
              }
            >
              {state === 'failed' ? t('Try again') : t('Show older')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
