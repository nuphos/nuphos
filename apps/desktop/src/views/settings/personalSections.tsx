import { faDisplay, faMoon, faSun } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { AgentAvatar } from '../../components/agent/AgentAvatar'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { useTheme } from '../../hooks/useTheme'
import { setAgentAppearance, useAgentAppearance } from '../../lib/agentAppearance'
import { isMac } from '../../lib/platform'
import { AuditLogView } from '../AuditLogView'
import { TeamMembersView } from '../TeamMembersView'

import { Field, SectionHeader } from './shared'

import type { ThemePreference } from '../../hooks/useTheme'
import type { JournalChatTarget } from '../../lib/journalEvent'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'

export function MembersSection({
  teamId,
  currentUserId,
}: {
  teamId: string | undefined
  currentUserId: string
}) {
  if (!teamId) {
    return (
      <div className="max-w-[640px] mx-auto py-10 px-8 text-[13px] text-tertiary">
        No workspace selected.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0">
      {/* No `filter` prop: the Settings overlay hides the main shell, so there
          is no toolbar search to drive it — the view renders its own instead. */}
      <TeamMembersView teamId={teamId} currentUserId={currentUserId} refreshKey={0} />
    </div>
  )
}

export function AuditSection({
  teamId,
  onOpenConversation,
}: {
  teamId: string | undefined
  onOpenConversation?: (sessionId: string, locate?: JournalChatTarget) => void
}) {
  if (!teamId) {
    return (
      <div className="max-w-[640px] mx-auto py-10 px-8 text-[13px] text-tertiary">
        No workspace selected.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 min-w-0">
      {/* No `filter` prop: the Settings overlay has no toolbar to drive it, so
          the view renders its own search box instead. */}
      <AuditLogView teamId={teamId} refreshKey={0} onOpenConversation={onOpenConversation} />
    </div>
  )
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: IconDefinition }[] = [
  { value: 'system', label: 'System', icon: faDisplay },
  { value: 'light', label: 'Light', icon: faSun },
  { value: 'dark', label: 'Dark', icon: faMoon },
]

// Rendered by scripts/render-app-icons.mjs; B2 is the bundled icon, A the original mark.
const APP_ICON_CHARACTERS = ['Napoleon', 'Pearl Earring', 'Van Gogh', 'The Scream', 'Son of Man']
const APP_ICON_LAYOUTS = ['Classic', 'Bleed', 'Peek']
const APP_ICONS = [
  { id: 'A', name: 'Nuphos' },
  ...APP_ICON_CHARACTERS.flatMap((character, c) =>
    APP_ICON_LAYOUTS.map((layout, l) => ({
      id: `${'BCDEF'[c]}${String(l + 1)}`,
      name: `${character}, ${layout}`,
    })),
  ),
]

function AppIconPicker() {
  const [selected, setSelected] = useState<string>()

  useEffect(() => {
    void api.appGetAppIcon().then(setSelected)
  }, [])

  const choose = (id: string) => {
    setSelected(id)
    api.appSetAppIcon(id).catch((e: unknown) => toast.apiError('Could not change the app icon', e))
  }

  return (
    <fieldset className="mt-8">
      <legend className="mb-1.5 text-[12.5px] font-medium text-secondary">App icon</legend>
      <div className="grid grid-cols-8 gap-2" role="group" aria-label="App icon">
        {APP_ICONS.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={selected === id}
            onClick={() => choose(id)}
            className={clsx(
              'aspect-square rounded-xl border-2 transition-colors',
              selected === id
                ? 'border-zViolet-500/70 bg-zViolet-500/10'
                : 'border-transparent hover:border-zGray-700',
            )}
          >
            <img src={`/app-icons/${id}.png`} alt="" className="w-full h-full" draggable={false} />
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-tertiary">Shown in the Dock while Nuphos runs.</p>
    </fieldset>
  )
}

export function AppearanceSection() {
  const { preference, setPreference } = useTheme()
  const { botAvatars, density } = useAgentAppearance()

  return (
    <div>
      <SectionHeader title="Appearance" description="Choose how the app looks on this device." />
      <Field label="Theme">
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((option) => {
            const active = preference === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreference(option.value)}
                className={clsx(
                  'flex flex-col items-center justify-center gap-2 h-[88px] rounded-lg border text-[13px] font-medium transition-colors',
                  active
                    ? 'border-zViolet-500/70 bg-zViolet-500/10 text-main'
                    : 'border-zGray-800 bg-surface text-secondary hover:border-zGray-700 hover:text-main',
                )}
              >
                <FontAwesomeIcon
                  icon={option.icon}
                  className={clsx('w-5 h-5', active ? 'text-zViolet-accent' : 'text-tertiary')}
                />
                {option.label}
              </button>
            )
          })}
        </div>
      </Field>
      {isMac && <AppIconPicker />}
      <div className="mt-8 space-y-5">
        <h3 className="text-[14px] font-semibold text-main">Agents</h3>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-main">Bot avatars</div>
            <p className="mt-1 text-[12px] text-tertiary">
              Give Agents a character avatar. Turn off to show Runtime icons.
            </p>
          </div>
          <Switch
            label="Bot avatars"
            checked={botAvatars}
            onChange={(next) => setAgentAppearance({ botAvatars: next })}
          />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-secondary">
            Sidebar density
          </legend>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Sidebar density">
            {(['compact', 'comfortable'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={density === value}
                onClick={() => setAgentAppearance({ density: value })}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors',
                  density === value
                    ? 'border-zViolet-500/70 bg-zViolet-500/10 text-main'
                    : 'border-zGray-800 bg-surface text-secondary hover:text-main',
                )}
              >
                {value === 'compact' ? 'Compact' : 'Comfortable'}
              </button>
            ))}
          </div>
        </fieldset>
        <div
          className="rounded-lg border border-zGray-800 bg-surface p-3"
          aria-label="Agent appearance preview"
        >
          <div className="mb-2 text-[11px] text-tertiary">Preview</div>
          <div
            className={clsx(
              'flex items-center gap-2.5 text-[14px] text-secondary',
              density === 'compact' ? 'h-[30px]' : 'h-[42px]',
            )}
          >
            <AgentAvatar agentId="appearance-preview" provider="claude-code" sidebar animated />
            <span>Product design</span>
          </div>
        </div>
      </div>
    </div>
  )
}
