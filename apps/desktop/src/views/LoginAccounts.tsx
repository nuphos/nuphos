import { faArrowRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { Avatar } from '../components/Avatar'
import { backendHost } from '../lib/backendHost'

import type { OtherAccount } from '../types'

/** The accounts still signed in on this device, each a one-click way back in. */
export function LoginAccounts({
  others,
  onPick,
}: {
  others: OtherAccount[]
  onPick: (key: string) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)

  if (others.length === 0) return null

  return (
    <div className="mb-5 w-full">
      <p className="mb-2 text-[12px] text-secondary">Continue as</p>
      <div className="flex flex-col gap-1.5">
        {others.map((other) => {
          const user = other.user
          const name = user ? user.name || user.username || user.email : 'Unknown account'
          // The same person can be signed in on several backends: name the server.
          const detail = [user?.email, backendHost(other.apiUrl)].filter(Boolean).join(' · ')

          return (
            <button
              key={other.key}
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setBusy(other.key)
                void onPick(other.key).finally(() => setBusy(null))
              }}
              className="group titlebar-no-drag flex w-full items-center gap-3 rounded-lg border border-zGray-800 bg-surface px-3 py-2.5 text-left transition-colors hover:border-zGray-700 disabled:opacity-60"
            >
              <Avatar
                src={user?.avatarURL}
                name={name}
                size={28}
                className="flex-shrink-0 rounded-full !shadow-none"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-main">{name}</span>
                {detail && (
                  <span className="block truncate text-[12px] text-tertiary">{detail}</span>
                )}
              </span>
              <FontAwesomeIcon
                icon={faArrowRight}
                className="text-[13px] text-tertiary transition-transform duration-200 group-hover:translate-x-1"
              />
            </button>
          )
        })}
      </div>
      <div className="mt-5 flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-zGray-800" />
        <span className="text-[12px] text-secondary">or sign in to another account</span>
        <div className="h-px flex-1 bg-zGray-800" />
      </div>
    </div>
  )
}
