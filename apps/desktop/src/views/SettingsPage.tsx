import { useEffect, useState } from 'react'

import { ArchivedChatsSection } from './settings/ArchivedChatsSection'
import { AuditSection, MembersSection } from './settings/personalSections'
import {
  TEAM_SETTINGS_DEFAULT_SECTION,
  settingsNavGroups,
  settingsScopeOf,
} from './settings/settingsNav'
import { SettingsNav } from './settings/SettingsNavPanel'
import { SettingsSectionBody } from './settings/SettingsSectionBody'
import { useResetOnKey } from './useResetOnKey'

import type { JournalChatTarget } from '../lib/journalEvent'
import type { AtlasTeam, UserInfo } from '../types'
import type { ReactNode } from 'react'

type Props = {
  onClose: () => void
  team: AtlasTeam | undefined
  user: UserInfo
  onUserUpdated: (user: UserInfo) => void
  onTeamUpdated: (team: AtlasTeam) => void
  /** The team was deleted (owner) or left (member); the caller drops scope off it. */
  onTeamRemoved: (teamId: string) => void
  onSignOut: () => void
  onOpenConversation?: (sessionId: string) => void
  /** Open an audit conversation in the read-only viewer (closes Settings first). */
  onOpenAuditConversation?: (sessionId: string, locate?: JournalChatTarget) => void
  /** Section to land on; its prefix also picks User settings vs Team settings. */
  initialSection?: string
}

/**
 * Full-screen settings overlay. Rendered only while open (mounted fresh each
 * time) so the active tab/section always reset to their defaults — no effect
 * needed to reconcile state on open.
 */
export function SettingsPage({
  onClose,
  team,
  user,
  onTeamUpdated,
  onTeamRemoved,
  onSignOut,
  onUserUpdated,
  onOpenConversation,
  onOpenAuditConversation,
  initialSection,
}: Props) {
  const [section, setSection] = useState<string>(initialSection ?? TEAM_SETTINGS_DEFAULT_SECTION)

  // The page mounts fresh on every open, but a deep entry point can also fire
  // while Settings is already open — resync to the newly requested section.
  useResetOnKey(initialSection ?? '', () => {
    if (initialSection) setSection(initialSection)
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const openAuditConversation = onOpenAuditConversation
    ? (sessionId: string, locate?: JournalChatTarget) => {
        onClose()
        onOpenAuditConversation(sessionId, locate)
      }
    : undefined
  const fullHeightSections: Partial<Record<string, ReactNode>> = {
    'workspace.members': <MembersSection teamId={team?.id} currentUserId={user.id} />,
    'workspace.audit': (
      <AuditSection teamId={team?.id} onOpenConversation={openAuditConversation} />
    ),
    'workspace.archived': (
      <ArchivedChatsSection
        teamId={team?.id}
        onOpenConversation={(sessionId) => onOpenConversation?.(sessionId)}
      />
    ),
  }
  const fullHeightSection = fullHeightSections[section]
  const scope = settingsScopeOf(section)
  const navGroups = settingsNavGroups(scope)

  return (
    <div className="fixed inset-0 z-50 flex flex-col content-canvas text-main">
      {/* Match the titlebar row the operation pages sit under, so the settings
          content starts at the same vertical offset. */}
      <div className="titlebar-drag h-[44px] flex-shrink-0" />

      <div className="flex min-h-0 flex-1">
        <SettingsNav groups={navGroups} section={section} onSelect={setSection} onBack={onClose} />

        <main className="flex flex-1 min-h-0 min-w-0 flex-col pr-1 pt-px pb-1">
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg rounded-br-xl border border-zGray-800/60 bg-main shadow-[0_4px_6px_-5px_rgba(0,0,0,0.2)]">
            {fullHeightSection ?? (
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <div className="max-w-[640px] mx-auto py-10 px-8">
                  <SettingsSectionBody
                    section={section}
                    team={team}
                    user={user}
                    onUserUpdated={onUserUpdated}
                    onTeamUpdated={onTeamUpdated}
                    onTeamRemoved={onTeamRemoved}
                    onSignOut={onSignOut}
                    onOpenConversation={onOpenConversation}
                  />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
