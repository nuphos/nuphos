import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { Avatar } from '../components/Avatar'
import { toast } from '../components/ui/toast'

import type { DiscoverableTeam } from '../types'
import type { FormEvent } from 'react'

type Props = {
  onClose: () => void
  /** Joins the team and refreshes the app's team list. */
  onJoin: (teamId: string) => Promise<void>
  /** Creates the team, switches to it, and closes this page. */
  onCreate: (name: string) => Promise<void>
}

/**
 * Full-screen "Create or join team" page (workspace picker → "Create or join
 * team"). Shows a "Join a team" list when workspaces advertise the user's
 * email domain — fetched fresh here, ignoring the post-login prompt's
 * dismissals, so a dismissed workspace can always be joined later — followed
 * by the create-a-team form. With no discoverable teams, only the form shows.
 */
export function CreateOrJoinTeamView({ onClose, onJoin, onCreate }: Props) {
  const [discoverable, setDiscoverable] = useState<DiscoverableTeam[] | null>(null)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false

    api
      .atlasListDiscoverableTeams()
      .then((teams) => {
        if (!cancelled) setDiscoverable(teams)
      })
      // Discovery failing should not block creating a team.
      .catch(() => {
        if (!cancelled) setDiscoverable([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function join(team: DiscoverableTeam) {
    if (joiningId) return
    setJoiningId(team.id)
    try {
      await onJoin(team.id)
      setJoinedIds((prev) => new Set(prev).add(team.id))
      toast.success(`Joined ${team.name}`)
    } catch (err) {
      toast.apiError(`Could not join ${team.name}`, err)
    } finally {
      setJoiningId(null)
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()

    if (!trimmed || creating) return
    setCreating(true)
    try {
      await onCreate(trimmed)
    } catch (err) {
      toast.apiError('Could not create team', err)
    } finally {
      setCreating(false)
    }
  }

  const hasDiscoverable = (discoverable?.length ?? 0) > 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col content-canvas text-main">
      <div className="titlebar-drag h-[44px] flex-shrink-0" />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-[52px] left-4 flex items-center gap-1 h-7 px-1.5 rounded-md text-[12px] font-normal text-tertiary hover:text-secondary hover:bg-zGray-800/50 transition-colors"
        title="Back"
        aria-label="Back"
      >
        <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" />
        Back
      </button>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="w-full max-w-[440px] mx-auto py-16 px-6">
          {hasDiscoverable && (
            <>
              <h1 className="text-[20px] font-semibold text-main text-center">Join a team</h1>
              <div className="mt-6 rounded-lg border border-zGray-800/70 bg-surface divide-y divide-zGray-800/60">
                {discoverable!.map((team) => {
                  const joined = joinedIds.has(team.id)
                  const joining = joiningId === team.id
                  const extraMembers = team.memberCount - team.memberPreviews.length

                  return (
                    <div key={team.id} className="flex items-center gap-3 px-3.5 py-3">
                      <Avatar
                        src={team.avatarUrl}
                        name={team.name}
                        size={32}
                        className="rounded-md !shadow-none flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-main truncate">
                          {team.name}
                        </div>
                        <div className="text-[12px] text-tertiary">
                          {team.memberCount === 1
                            ? '1 member'
                            : `${String(team.memberCount)} members`}
                        </div>
                      </div>
                      <div className="flex items-center flex-shrink-0">
                        {team.memberPreviews.map((member, index) => (
                          <span
                            key={`${team.id}:${String(index)}`}
                            className={clsx(
                              'block rounded-full ring-2 ring-surface',
                              index > 0 && '-ml-1.5',
                            )}
                          >
                            <Avatar
                              src={member.avatarURL}
                              name={member.name}
                              size={22}
                              className="rounded-full !shadow-none"
                            />
                          </span>
                        ))}
                        {extraMembers > 0 && (
                          <span className="-ml-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-zGray-800 px-1 text-[10px] font-medium text-secondary ring-2 ring-surface">
                            +{extraMembers}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void join(team)}
                        disabled={joined || joiningId !== null}
                        className={clsx(
                          'h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors flex-shrink-0',
                          joined
                            ? 'bg-transparent text-tertiary cursor-default'
                            : joiningId === null
                              ? 'bg-zViolet-500 text-white hover:bg-zViolet-400'
                              : 'bg-zGray-700 text-tertiary cursor-default',
                        )}
                      >
                        {joined ? 'Joined' : joining ? 'Joining…' : 'Join'}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="my-8 flex items-center gap-3">
                <div className="h-px flex-1 bg-zGray-800/70" />
                <span className="text-[12px] text-tertiary">or</span>
                <div className="h-px flex-1 bg-zGray-800/70" />
              </div>
            </>
          )}

          <h1
            className={clsx(
              'font-semibold text-main text-center',
              hasDiscoverable ? 'text-[16px]' : 'text-[20px]',
            )}
          >
            Create a team
          </h1>
          <form onSubmit={(e) => void create(e)} className="mt-6 space-y-5">
            <label className="block">
              <span className="block text-[12.5px] text-tertiary mb-1.5">Name</span>
              <input
                type="text"
                required
                autoFocus={!hasDiscoverable}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Engineering"
                className="w-full h-10 rounded-md border border-zGray-800 bg-field px-3 text-[13px] text-main outline-none transition-colors focus:border-zViolet-500/70 placeholder:text-tertiary"
              />
            </label>
            {/* Enabled fill per design: soft off-white in dark mode (zGray-100
                ≈ rgb 234 there), overridden to pure white on the light theme
                via the html.light ancestor variant. The hairline black/10
                border keeps it visible on light's near-white canvas. */}
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className={clsx(
                'w-full h-10 rounded-md text-[13px] font-medium transition-colors',
                name.trim() && !creating
                  ? 'bg-zGray-100 hover:bg-zGray-150 [.light_&]:bg-white [.light_&]:hover:bg-neutral-100 text-black border border-black/10'
                  : 'border border-zGray-800 text-secondary opacity-50 cursor-default',
              )}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
