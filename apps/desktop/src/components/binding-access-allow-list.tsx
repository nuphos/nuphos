import clsx from 'clsx'
import { Search, X } from 'lucide-react'
import { useState } from 'react'

import {
  ALL_ALLOW_LIST,
  allowListIsAll,
  memberDisplayName,
  normalizeAllowList,
} from '../lib/bindingAccess'

import { Avatar } from './Avatar'

import type { TeamMember } from '../types'

function accessSummary(list: string[]): string {
  if (allowListIsAll(list)) return 'All team members'
  if (list.length === 0) return 'No one'

  return `${String(list.length)} selected`
}

export function AllowListSelect({
  title,
  subtitle,
  allowList,
  members,
  onChange,
}: {
  title: string
  subtitle: string
  allowList: string[]
  members: TeamMember[]
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const all = allowListIsAll(allowList)
  const selectedIds = all
    ? members.map((member) => member.id)
    : allowList.filter((id) => id !== '*')
  const selectedIdSet = new Set(selectedIds)
  const selectedMembers = selectedIds.map((id) => ({
    id,
    member: members.find((item) => item.id === id) ?? null,
  }))
  const normalizedQuery = query.trim().toLowerCase()
  const searchResults = normalizedQuery
    ? members
        .filter((member) => {
          if (selectedIdSet.has(member.id)) return false

          return `${memberDisplayName(member)} ${member.email} ${member.username}`
            .toLowerCase()
            .includes(normalizedQuery)
        })
        .slice(0, 8)
    : []

  function addMember(member: TeamMember) {
    if (all) return
    onChange(normalizeAllowList([...allowList, member.id]))
    setQuery('')
  }

  function removeMember(userId: string) {
    if (all) {
      onChange(members.map((member) => member.id).filter((id) => id !== userId))

      return
    }
    onChange(allowList.filter((id) => id !== userId))
  }

  return (
    <div className="min-w-0 py-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main">{title}</div>
            <div className="text-[12px] text-tertiary mt-0.5">{subtitle}</div>
          </div>
          <div className="flex flex-col items-end gap-1.5 whitespace-nowrap">
            <div className="inline-flex rounded-md border border-zGray-800 bg-zGray-900 p-0.5">
              <button
                type="button"
                onClick={() => onChange([...ALL_ALLOW_LIST])}
                className={clsx(
                  'px-2.5 h-6 rounded text-[11.5px] font-medium transition-colors',
                  all ? 'bg-zViolet-500 text-white' : 'text-tertiary hover:text-main',
                )}
              >
                All members
              </button>
              <button
                type="button"
                onClick={() => {
                  // Switching away from the wildcard starts from an empty explicit
                  // list rather than silently snapshotting the current team.
                  if (all) onChange([])
                }}
                className={clsx(
                  'px-2.5 h-6 rounded text-[11.5px] font-medium transition-colors',
                  all ? 'text-tertiary hover:text-main' : 'bg-zGray-800 text-main',
                )}
              >
                Specific
              </button>
            </div>
            <div className="text-[12px] text-secondary">{accessSummary(allowList)}</div>
          </div>
        </div>
        <div className="mt-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tertiary"
              strokeWidth={1.8}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={all}
              placeholder={all ? 'All members are allowed' : 'Search members to add'}
              className="w-full h-8 rounded-md bg-field border border-zGray-800 pl-8 pr-2 text-[12.5px] text-main placeholder:text-tertiary outline-none focus:border-zViolet-500/60 disabled:opacity-50"
            />
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-zGray-800 bg-zGray-850 shadow-2xl shadow-black/40 py-1">
                {searchResults.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => addMember(member)}
                    className="w-full px-2.5 py-2 flex items-center gap-2 hover:bg-zGray-800 text-left"
                  >
                    <Avatar
                      src={member.avatarURL}
                      name={memberDisplayName(member)}
                      size={24}
                      className="rounded-[5px] !shadow-none"
                    />
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-main truncate">
                        {memberDisplayName(member)}
                      </div>
                      <div className="text-[11.5px] text-tertiary truncate">{member.email}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-zGray-850 divide-y divide-zGray-850">
        {selectedMembers.length === 0 ? (
          <div className="py-4 text-[12.5px] text-tertiary">No selected members.</div>
        ) : (
          selectedMembers.map(({ id, member }) => (
            <div key={id} className="py-2.5 flex items-center gap-3">
              {member ? (
                <Avatar
                  src={member.avatarURL}
                  name={memberDisplayName(member)}
                  size={28}
                  className="rounded-[6px] !shadow-none"
                />
              ) : (
                <div className="w-7 h-7 rounded-md bg-zGray-850 flex items-center justify-center text-[11px] text-tertiary">
                  ?
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-main truncate">
                  {member ? memberDisplayName(member) : 'Unknown member'}
                </div>
                <div className="text-[11.5px] text-tertiary truncate">
                  {member ? member.email : 'Not in current team list'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeMember(id)}
                className="w-7 h-7 rounded-md text-tertiary hover:text-main hover:bg-zGray-800 flex items-center justify-center"
                title="Remove"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.8} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
