import { ChevronRight, Loader2 } from 'lucide-react'

import { t } from '../../../i18n'
import { MenuContent, MenuItem, MenuSubmenu, MenuSubmenuTrigger } from '../../ui/menu'

import { relativeTimeFromNow } from './textUtils'

import type { LocalAgentSessionInfo, LocalSessionSource } from '../../../api'
import type { ReactNode, SVGProps } from 'react'

export function SessionSubmenu({
  source,
  label,
  title,
  Icon,
  items,
  loading,
  error,
  onOpen,
  onAttach,
  onImport,
}: {
  source: LocalSessionSource
  label: string
  title: string
  Icon: (props: SVGProps<SVGSVGElement>) => ReactNode
  items: LocalAgentSessionInfo[]
  loading: boolean
  error?: string
  onOpen: (source: LocalSessionSource) => void
  onAttach: (session: LocalAgentSessionInfo) => void
  /** Continues the session on the selected agent instead of attaching its log.
   *  Absent outside a new conversation, where there is no agent to import onto. */
  onImport?: (session: LocalAgentSessionInfo) => void
}) {
  return (
    <MenuSubmenu
      onOpenChange={(open) => {
        if (open) onOpen(source)
      }}
    >
      <MenuSubmenuTrigger
        icon={<Icon className="w-3.5 h-3.5 flex-shrink-0" />}
        chevron={<ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />}
        title={title}
      >
        {label}
      </MenuSubmenuTrigger>
      <MenuContent alignOffset={-6} className="w-[300px]">
        <div className="h-8 px-2 flex items-center gap-2 text-[12px] text-tertiary">
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{title}</span>
          {loading && <Loader2 className="ml-auto w-3.5 h-3.5 animate-spin" strokeWidth={2} />}
        </div>
        {error ? (
          <div className="px-2 py-2 text-[12px] text-error">{t('Failed to load sessions')}</div>
        ) : loading && items.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-tertiary">{t('Loading...')}</div>
        ) : items.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-tertiary">{t('No recent sessions')}</div>
        ) : (
          <div className="max-h-64 overflow-auto scrollbar-thin">
            {items.map((session) => (
              <MenuItem
                key={session.id}
                onClick={() => (onImport ? onImport(session) : onAttach(session))}
                title={session.path}
              >
                <span className="flex w-full min-w-0 flex-col">
                  <span className="w-full truncate text-[12.5px]">{session.title}</span>
                  <span className="w-full truncate text-[11px] text-tertiary">
                    {session.subtitle} · {relativeTimeFromNow(session.updatedAt)}
                  </span>
                </span>
              </MenuItem>
            ))}
          </div>
        )}
      </MenuContent>
    </MenuSubmenu>
  )
}
