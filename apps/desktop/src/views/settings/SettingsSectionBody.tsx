import { AgentSection } from './AgentSection'
import { AutoModeSection } from './AutoModeSection'
import { GeneralSection } from './GeneralSection'
import { InstructionsSection } from './InstructionsSection'
import { LocalExecSection } from './LocalExecSection'
import { LocalRuntimeSection } from './LocalRuntimeSection'
import { AppearanceSection } from './personalSections'
import { ProfileSection } from './ProfileSection'

import type { AtlasTeam, UserInfo } from '../../types'
import type { ReactNode } from 'react'

type SectionProps = {
  team: AtlasTeam | undefined
  user: UserInfo
  onUserUpdated: (user: UserInfo) => void
  onTeamUpdated: (team: AtlasTeam) => void
  onTeamRemoved: (teamId: string) => void
  onSignOut: () => void
  onOpenConversation?: (sessionId: string) => void
}

const SECTIONS: Partial<Record<string, (props: SectionProps) => ReactNode>> = {
  'workspace.general': ({ team, user, onTeamUpdated, onTeamRemoved }) => (
    <GeneralSection
      team={team}
      userEmail={user.email}
      onTeamUpdated={onTeamUpdated}
      onTeamRemoved={onTeamRemoved}
    />
  ),
  'workspace.agent': ({ team }) => <AgentSection team={team} />,
  'workspace.instructions': ({ team }) => <InstructionsSection team={team} scope="team" />,
  'preferences.instructions': ({ team }) => <InstructionsSection team={team} scope="personal" />,
  'account.profile': ({ user, onSignOut, onUserUpdated }) => (
    <ProfileSection user={user} onSignOut={onSignOut} onUserUpdated={onUserUpdated} />
  ),
  'account.autoMode': () => <AutoModeSection />,
  'device.appearance': () => <AppearanceSection />,
  'device.localRuntime': ({ team, onOpenConversation }) => (
    <LocalRuntimeSection currentTeamId={team?.id} onOpenConversation={onOpenConversation} />
  ),
  'device.localExec': ({ team, onOpenConversation }) => (
    <LocalExecSection currentTeamId={team?.id} onOpenConversation={onOpenConversation} />
  ),
}

export function SettingsSectionBody({ section, ...props }: SectionProps & { section: string }) {
  return SECTIONS[section]?.(props) ?? null
}
