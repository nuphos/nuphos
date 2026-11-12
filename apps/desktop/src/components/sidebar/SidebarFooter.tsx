import { t } from '../../i18n'
import { CloudLogo } from '../CloudLogo'
import { Button } from '../ui/button'

import { SidebarUserEntry } from './header'
import { SidebarHelpMenu } from './help-menu'
import { SidebarInvitations } from './parts'

import type { SidebarProps } from './types'

type Props = { active: string; onSelect: (key: string) => void } & Pick<
  SidebarProps,
  | 'user'
  | 'onOpenUserSettings'
  | 'onLogout'
  | 'pendingInvitations'
  | 'onAcceptInvitation'
  | 'onRejectInvitation'
  | 'onOpenShortcutsHelp'
>

export function SidebarFooter({
  active,
  onSelect,
  user,
  onOpenUserSettings,
  onLogout,
  pendingInvitations = [],
  onAcceptInvitation,
  onRejectInvitation,
  onOpenShortcutsHelp,
}: Props) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-2.5 py-2">
      {user ? (
        <SidebarUserEntry
          compact
          user={user}
          onOpenUserSettings={onOpenUserSettings}
          onLogout={onLogout}
        />
      ) : (
        <div className="flex-1" />
      )}
      {pendingInvitations.length > 0 && (
        <SidebarInvitations
          invitations={pendingInvitations}
          onAccept={onAcceptInvitation}
          onReject={onRejectInvitation}
        />
      )}
      <Button
        variant="secondary"
        size="sm"
        aria-pressed={active === 'team.integrations'}
        onClick={() => onSelect('team.integrations')}
        className="min-w-0 flex-1 !rounded-full gap-1.5 aria-pressed:bg-state-selected"
      >
        {t('Connectors')}
        <span aria-hidden className="inline-flex -space-x-1 pl-1">
          {(['google-drive', 'github', 'notion'] as const).map((provider) => (
            <span
              key={provider}
              className="flex size-4 items-center justify-center rounded bg-surface-raised ring-1 ring-line-control"
            >
              <CloudLogo provider={provider} size={11} />
            </span>
          ))}
        </span>
      </Button>
      <SidebarHelpMenu onOpenShortcutsHelp={onOpenShortcutsHelp} />
    </div>
  )
}
