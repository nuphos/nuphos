import clsx from 'clsx'

import { t } from '../../i18n'
import { CloudLogo } from '../CloudLogo'
import { Button } from '../ui/button'

import { SidebarUserEntry } from './header'
import { SidebarHelpMenu } from './help-menu'
import { SidebarInvitations } from './parts'

import type { SidebarProps } from './types'

type Props = { connectorsOpen: boolean; onSelect: (key: string) => void } & Pick<
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
  connectorsOpen,
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
    <div className="group/footer flex-shrink-0 flex items-center gap-2 px-2.5 py-2">
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
        aria-pressed={connectorsOpen}
        onClick={() => onSelect('team.integrations')}
        className={clsx(
          '@container min-w-0 flex-1 !rounded-full gap-1.5 aria-pressed:bg-state-selected',
          // The open update pill lies over this button: its label fades, so none shows half-covered.
          '[&>*]:transition-opacity [&>*]:duration-200 [&>*]:ease-out motion-reduce:[&>*]:transition-none',
          'group-has-[[data-update-pill]:enabled:hover]/footer:[&>*]:opacity-0',
          'group-has-[[data-update-pill]:focus-visible]/footer:[&>*]:opacity-0',
        )}
      >
        {t('Connectors')}
        {/* The logos give way when the row is short of room, as when an update waits beside Help. */}
        <span aria-hidden className="hidden -space-x-1 pl-1 @[146px]:inline-flex">
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
