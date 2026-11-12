import clsx from 'clsx'

import { NewChatButton } from '../../components/sidebar/NewChatButton'
import { t } from '../../i18n'

import { CornerSidebarToggle } from './CornerSidebarToggle'

export function WorkspaceBotsStart({
  teamId,
  onOpen,
  visible = true,
}: {
  visible?: boolean
  teamId: string
  onOpen: (sessionId: string) => void
}) {
  return (
    <main
      data-workspace-focus-surface="session"
      inert={!visible}
      aria-hidden={!visible}
      className={clsx(
        'workspace-content-surface min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        visible ? 'flex' : 'hidden',
      )}
    >
      <div className="workspace-agent-titlebar sheet-titlebar-row titlebar-drag flex shrink-0 items-center gap-2 pl-3 text-[13px] font-medium text-secondary">
        <CornerSidebarToggle />
        {t('New Bot')}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [container-type:size]">
        <div className="flex min-h-full flex-col px-6 pb-8">
          <div className="mx-auto flex min-h-[50cqh] w-full max-w-[820px] flex-col justify-end pt-10">
            <NewChatButton visible={visible} teamId={teamId} onCreated={onOpen} empty />
          </div>
        </div>
      </div>
    </main>
  )
}
