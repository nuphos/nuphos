import { faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { Avatar } from '../components/Avatar'
import { SidebarNamePreview } from '../components/sidebar/SidebarNamePreview'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'

import type { DiscoverableTeam, UserInfo } from '../types'
import type { FormEvent } from 'react'

type Props = {
  /** Signed-in user, shown in the sidebar preview's footer. */
  user: UserInfo
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
export function CreateOrJoinTeamView({ user, onClose, onJoin, onCreate }: Props) {
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
      toast.success(t('Joined {name}', { name: team.name }))
    } catch (err) {
      toast.apiError(t('Could not join {name}', { name: team.name }), err)
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
      toast.apiError(t('Could not create team'), err)
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
        className="absolute top-[52px] left-4 flex items-center gap-1 h-7 px-1.5 rounded-md text-[12px] font-normal text-tertiary hover:text-secondary hover:bg-state-hover transition-colors"
        title={t('Back')}
        aria-label={t('Back')}
      >
        <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" />
        {t('Back')}
      </button>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="w-full max-w-[440px] mx-auto py-16 px-6">
            {hasDiscoverable && (
              <>
                <h1 className="text-[20px] font-semibold text-main">{t('Join a team')}</h1>
                <div className="mt-6 rounded-lg border border-line-control/70 bg-surface divide-y divide-line-control/60">
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
                              ? t('1 member')
                              : t('{count} members', { count: String(team.memberCount) })}
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
                            <span className="-ml-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-surface-sunken px-1 text-[10px] font-medium text-secondary ring-2 ring-surface">
                              +{extraMembers}
                            </span>
                          )}
                        </div>
                        <Button
                          variant={joined ? 'ghost' : 'primary'}
                          size="sm"
                          className="flex-shrink-0"
                          type="button"
                          onClick={() => void join(team)}
                          disabled={joined || joiningId !== null}
                        >
                          {joined ? t('Joined') : joining ? t('Joining…') : t('Join')}
                        </Button>
                      </div>
                    )
                  })}
                </div>

                <div className="my-8 flex items-center gap-3">
                  <div className="h-px flex-1 bg-state-selected" />
                  <span className="text-[12px] text-tertiary">{t('or')}</span>
                  <div className="h-px flex-1 bg-state-selected" />
                </div>
              </>
            )}

            <h1
              className={clsx(
                'font-semibold text-main',
                hasDiscoverable ? 'text-[16px]' : 'text-[20px]',
              )}
            >
              {t('Create a team')}
            </h1>
            <p className="mt-1.5 text-[13px] text-tertiary">
              {t('Your team will see this name in the sidebar.')}
            </p>
            <form onSubmit={(e) => void create(e)} className="mt-6 space-y-5">
              <label className="block">
                <span className="block text-[12.5px] text-tertiary mb-1.5">{t('Name')}</span>
                <input
                  type="text"
                  required
                  autoFocus={!hasDiscoverable}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Engineering')}
                  className="w-full h-10 rounded-md border border-line-control bg-surface px-3 text-[13px] text-main outline-none transition-colors focus:border-line-focus placeholder:text-tertiary"
                />
              </label>
              {/* Enabled fill per design: soft off-white in dark mode, overridden to pure white on the light theme
                via the html.light ancestor variant. The hairline black/10
                border keeps it visible on light's near-white canvas. */}
              <button
                type="submit"
                disabled={!name.trim() || creating}
                className={clsx(
                  'w-full h-10 rounded-md text-[13px] font-medium transition-colors',
                  name.trim() && !creating
                    ? 'bg-action-primary text-inverse hover:bg-action-primary/90'
                    : 'border border-line-control text-secondary opacity-50 cursor-default',
                )}
              >
                {creating ? t('Creating…') : t('Create')}
              </button>
            </form>
          </div>
        </div>
        {/* The name shows in the sidebar as it is typed (wide windows only). The
            column runs up under the titlebar strip, so it stays draggable, and its
            top lines up with the heading (44px titlebar + 64px padding). */}
        <div className="titlebar-drag -mt-[44px] hidden lg:flex w-[42%] items-start overflow-hidden pl-16 pt-[108px] border-l border-line-control/60 bg-main">
          <SidebarNamePreview name={name.trim() || t('Engineering')} user={user} />
        </div>
      </div>
    </div>
  )
}
