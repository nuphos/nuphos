import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { GeneralSection } from './GeneralSection'
import { InstructionsSection } from './InstructionsSection'
import { LocalExecSection } from './LocalExecSection'
import { LocalRuntimeSection } from './LocalRuntimeSection'
import { LocalSetupSection } from './LocalSetupSection'
import { AppearanceSection } from './personalSections'
import { PrivacySection } from './PrivacySection'
import { ProfileSection } from './ProfileSection'
import { SignedInDevicesSection } from './SignedInDevicesSection'
import { TwoFactorSection } from './TwoFactorSection'
import { UpdatesSection } from './UpdatesSection'

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
  onOpenSection?: (section: string) => void
  onOpenConnectors?: () => void
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
  'workspace.instructions': ({ team }) => <InstructionsSection team={team} scope="team" />,
  'preferences.instructions': ({ team }) => <InstructionsSection team={team} scope="personal" />,
  'preferences.localSetup': ({ team }) => <LocalSetupSection team={team} />,
  'account.profile': ({ user, onSignOut, onUserUpdated }) => (
    <ProfileSection user={user} onSignOut={onSignOut} onUserUpdated={onUserUpdated} />
  ),
  'account.personalCredentials': ({ onOpenConnectors }) => (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">{t('Personal Credentials')}</h2>
      <p className="text-secondary">
        {t('Connect your own accounts so your Bots and tasks act as you.')}
      </p>
      <Button onClick={onOpenConnectors}>{t('Connectors')}</Button>
    </div>
  ),
  'account.devices': ({ onSignOut }) => <SignedInDevicesSection onSignOut={onSignOut} />,
  'account.mfa': ({ onSignOut }) => <TwoFactorSection onSignOut={onSignOut} />,
  'device.appearance': () => <AppearanceSection />,
  'device.updates': () => <UpdatesSection />,
  'device.privacy': () => <PrivacySection />,
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
