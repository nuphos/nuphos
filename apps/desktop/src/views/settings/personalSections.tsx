import { faDisplay, faMoon, faSun } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'

import { useTheme } from '../../hooks/useTheme'
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

export function AppearanceSection() {
  const { preference, setPreference } = useTheme()

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
    </div>
  )
}
