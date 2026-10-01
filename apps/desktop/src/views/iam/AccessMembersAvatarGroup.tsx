import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { allowListIsAll, memberDisplayName, normalizeAllowList } from '../../lib/bindingAccess'
import { useResetOnKey } from '../useResetOnKey'

import type { TeamMember } from '../../types'

const ACCESS_AVATAR_SIZE = 24
const ACCESS_AVATAR_CHROME =
  'shrink-0 !rounded-full border-2 border-zGray-900 !shadow-none !bg-zGray-850'
const avatarImageLoadCache = new Map<string, Promise<boolean>>()

type AccessMemberEntry = {
  id: string
  member: TeamMember | null
}

function preloadAvatarImage(url: string): Promise<boolean> {
  const cached = avatarImageLoadCache.get(url)

  if (cached) return cached
  const promise = new Promise<boolean>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(false)

      return
    }
    const image = new Image()

    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.decoding = 'async'
    image.src = url
  })

  avatarImageLoadCache.set(url, promise)

  return promise
}

export function AccessMembersAvatarGroup({
  allowList,
  members,
  resourceLabel,
}: {
  allowList: string[] | undefined
  members: TeamMember[]
  resourceLabel: 'role' | 'service account'
}) {
  const normalized = normalizeAllowList(allowList)

  if (normalized.length === 0) {
    return <span className="text-[12px] text-tertiary">—</span>
  }

  const all = allowListIsAll(normalized)
  const memberById = new Map(members.map((member) => [member.id, member]))
  const entries = all
    ? members.map((member) => ({ id: member.id, member }))
    : normalized.map((id) => ({ id, member: memberById.get(id) ?? null }))
  const visible = entries.slice(0, 4)
  const hiddenCount = Math.max(0, entries.length - visible.length)
  const label = all
    ? `All team members can access this ${resourceLabel}`
    : `${String(entries.length)} member${entries.length === 1 ? '' : 's'} can access this ${resourceLabel}`

  return (
    <LoadedAccessMembersAvatarGroup
      all={all}
      entries={entries}
      hiddenCount={hiddenCount}
      label={label}
      visible={visible}
    />
  )
}

function LoadedAccessMembersAvatarGroup({
  all,
  entries,
  hiddenCount,
  label,
  visible,
}: {
  all: boolean
  entries: AccessMemberEntry[]
  hiddenCount: number
  label: string
  visible: AccessMemberEntry[]
}) {
  const avatarLoadKey = visible
    .map(({ member }) => member?.avatarURL)
    .filter((url): url is string => Boolean(url))
    .join('\0')
  const [ready, setReady] = useState(avatarLoadKey.length === 0)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set())

  useResetOnKey(avatarLoadKey, () => {
    setReady(false)
    setFailedUrls(new Set())
  })

  useEffect(() => {
    let cancelled = false
    const avatarUrls = avatarLoadKey
      ? avatarLoadKey.split('\0').filter((url) => url.length > 0)
      : []

    if (avatarUrls.length === 0) {
      const frame = window.requestAnimationFrame(() => {
        if (!cancelled) setReady(true)
      })

      return () => {
        cancelled = true
        window.cancelAnimationFrame(frame)
      }
    }

    Promise.all(avatarUrls.map(async (url) => ({ url, loaded: await preloadAvatarImage(url) })))
      .then((results) => {
        if (cancelled) return
        setFailedUrls(
          new Set(results.filter((result) => !result.loaded).map((result) => result.url)),
        )
        window.requestAnimationFrame(() => {
          if (!cancelled) setReady(true)
        })
      })
      .catch(() => {
        if (cancelled) return
        setFailedUrls(new Set(avatarUrls))
        window.requestAnimationFrame(() => {
          if (!cancelled) setReady(true)
        })
      })

    return () => {
      cancelled = true
    }
  }, [avatarLoadKey])

  return (
    <div
      className={clsx(
        't-skel t-access-avatar-reveal flex items-center gap-2 min-w-0 w-full',
        ready && 'is-revealed',
      )}
      title={label}
    >
      <div className="t-skel-skeleton is-pulsing flex items-center gap-2" aria-hidden="true">
        <div className="flex -space-x-2">
          {visible.map(({ id }) => (
            <div
              key={id}
              className={clsx(ACCESS_AVATAR_CHROME, 'bg-zGray-800')}
              style={{ width: ACCESS_AVATAR_SIZE, height: ACCESS_AVATAR_SIZE }}
            />
          ))}
          {hiddenCount > 0 && (
            <div
              className={clsx(ACCESS_AVATAR_CHROME, 'bg-zGray-800')}
              style={{ width: ACCESS_AVATAR_SIZE, height: ACCESS_AVATAR_SIZE }}
            />
          )}
        </div>
        <div className="h-3 w-20 rounded bg-zGray-800" />
      </div>
      <div className="t-skel-content flex items-center gap-2 min-w-0">
        <div className="flex -space-x-2">
          {visible.map(({ id, member }) =>
            member ? (
              <Avatar
                key={id}
                src={
                  member.avatarURL && !failedUrls.has(member.avatarURL) ? member.avatarURL : null
                }
                name={memberDisplayName(member)}
                size={ACCESS_AVATAR_SIZE}
                className={ACCESS_AVATAR_CHROME}
              />
            ) : (
              <div
                key={id}
                className={clsx(
                  ACCESS_AVATAR_CHROME,
                  'flex items-center justify-center text-[10px] text-tertiary',
                )}
                style={{ width: ACCESS_AVATAR_SIZE, height: ACCESS_AVATAR_SIZE }}
              >
                ?
              </div>
            ),
          )}
          {hiddenCount > 0 && (
            <div
              className={clsx(
                ACCESS_AVATAR_CHROME,
                'flex items-center justify-center text-[10px] font-medium text-secondary',
              )}
              style={{ width: ACCESS_AVATAR_SIZE, height: ACCESS_AVATAR_SIZE }}
            >
              +{hiddenCount}
            </div>
          )}
        </div>
        <span className="text-[12px] text-tertiary truncate">
          {all
            ? 'All members'
            : `${String(entries.length)} member${entries.length === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  )
}
