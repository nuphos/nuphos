import { useEffect, useRef, useState } from 'react'

import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'

import { resolveOwnTeam, starterRuntime } from './claimComputer'
import { FacePicker } from './ClaimParts'
import { createStarterBot, defaultBotName } from './createStarterBot'
import { faceSrc, randomFace } from './faces'
import { useSequence } from './sequence'
import { TourLayout } from './TourLayout'

import type { StarterRuntime } from './starterSelection'
import type { TourTool } from './tools'
import type { AtlasTeam } from '../../../types'

/**
 * A face and a name for the first Bot. Create picks where it runs without
 * saying so: this computer's signed-in Claude Code or Codex, else the computer
 * from Nuphos, waited for behind the same "setting up" state.
 */
export function FirstBotPage({
  picks,
  onCreateWorkspace,
  onStarted,
  onFinish,
}: {
  picks: readonly TourTool[]
  onCreateWorkspace: (name: string) => Promise<AtlasTeam>
  /** Create was pressed; the team may exist from here on. */
  onStarted: () => void
  onFinish: (teamId: string, channelId: string) => void
}) {
  const { revealed } = useSequence(() => [[0.3, () => {}]])
  const [face, setFace] = useState(randomFace)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)
  const team = useRef<string | undefined>(undefined)
  const runtime = useRef<StarterRuntime | undefined>(undefined)
  const suggested = defaultBotName(face)

  useEffect(() => {
    // StrictMode mounts twice in development; the second mount is the live one.
    cancelled.current = false

    return () => {
      cancelled.current = true
    }
  }, [])

  // A retry goes on from the team and runtime already found.
  const create = async () => {
    if (creating) return
    setCreating(true)
    setError(null)
    onStarted()
    try {
      team.current ??= await resolveOwnTeam(onCreateWorkspace)
      runtime.current ??= await starterRuntime(team.current, () => cancelled.current)
      const channelId = await createStarterBot({
        teamId: team.current,
        runtime: runtime.current,
        name: name.trim() || suggested,
        avatar: face,
        picks,
      })

      if (!cancelled.current) onFinish(team.current, channelId)
    } catch {
      if (cancelled.current) return
      setError(t('Could not finish setting up the Bot. Retry to continue.'))
      setCreating(false)
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <TourLayout
        title={t('Name your first Bot')}
        subtitle={t('You can change its face and name anytime.')}
        revealed={revealed}
        note={error && <p className="max-w-sm text-[12.5px] text-attention">{error}</p>}
        actions={
          <Button type="submit" disabled={creating}>
            {creating ? t('Setting up your Bot…') : t('Create')}
          </Button>
        }
        art={
          <div className="flex w-full flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-5">
              <img
                src={faceSrc(face)}
                alt={t('Your first Bot’s face')}
                className="size-[104px] rounded-full bg-surface-sunken object-contain"
              />
              <input
                autoFocus
                aria-label={t('Bot name')}
                maxLength={120}
                value={name}
                placeholder={suggested}
                disabled={creating}
                onChange={(event) => setName(event.target.value)}
                className="h-12 w-60 rounded-full border border-line-control bg-surface-raised px-4 text-center text-[17px] font-semibold text-primary outline-none placeholder:text-tertiary focus:border-line-focus"
              />
            </div>
            <div className="w-full" inert={creating}>
              <FacePicker face={face} onPick={setFace} />
            </div>
          </div>
        }
      />
    </form>
  )
}
