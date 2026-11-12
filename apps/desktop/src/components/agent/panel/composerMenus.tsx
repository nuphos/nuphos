import { faFolder, faPaperclip } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { ChevronRight, FileSearch, Loader2, Lock, Plus, Unlock } from 'lucide-react'

import { t } from '../../../i18n'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'

import { ClaudeCodeIcon, CodexIcon } from './icons'
import { relativeTimeFromNow } from './textUtils'

import type { LocalAgentSessionInfo, LocalSessionSource } from '../../../api'
import type { ReactNode, SVGProps } from 'react'

function SessionSubmenu({
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

export function ComposerAttachmentMenu({
  open,
  onOpenChange,
  readOnly,
  hero,
  localSessionsBySource,
  localSessionsLoading,
  localSessionsError,
  onOpenSource,
  onAttachSession,
  onImportSession,
  onSelectAttachment,
  onSelectFolderAttachment,
  bypassControl,
}: {
  /** 'permissions' opens it on its Permissions submenu, as /permissions does. */
  open: boolean | 'permissions'
  onOpenChange: (open: boolean) => void
  readOnly: boolean
  hero: boolean
  localSessionsBySource: Partial<Record<LocalSessionSource, LocalAgentSessionInfo[]>>
  localSessionsLoading: Partial<Record<LocalSessionSource, boolean>>
  localSessionsError: Partial<Record<LocalSessionSource, string>>
  onOpenSource: (source: LocalSessionSource) => void
  onAttachSession: (session: LocalAgentSessionInfo) => void
  /** Imports the session as a Nuphos conversation; undefined where the composer
   *  has no agent to import onto (an existing conversation). */
  onImportSession?: (session: LocalAgentSessionInfo) => void
  onSelectAttachment: () => void
  onSelectFolderAttachment: () => void
  /** Auto Mode ↔ Full Access; absent before the conversation has a session. */
  bypassControl?: { active: boolean; onSelect: (bypass: boolean) => void }
}) {
  const sessionSubmenu = (
    source: LocalSessionSource,
    label: string,
    title: string,
    Icon: (props: SVGProps<SVGSVGElement>) => ReactNode,
  ) => (
    <SessionSubmenu
      source={source}
      label={label}
      title={onImportSession ? t('Continue one of these on the selected runtime') : title}
      Icon={Icon}
      items={localSessionsBySource[source] ?? []}
      loading={Boolean(localSessionsLoading[source])}
      error={localSessionsError[source]}
      onOpen={onOpenSource}
      onAttach={onAttachSession}
      onImport={onImportSession}
    />
  )

  return (
    <Menu open={Boolean(open)} onOpenChange={onOpenChange}>
      <MenuTrigger
        disabled={readOnly}
        className={clsx(
          hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
          'flex items-center justify-center transition-colors flex-shrink-0',
          readOnly
            ? 'text-tertiary'
            : 'text-secondary hover:text-main hover:bg-state-hover data-[popup-open]:bg-state-selected data-[popup-open]:text-main',
        )}
        title={t('Attach, and more')}
      >
        <Plus className="w-4 h-4" strokeWidth={2.2} />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-56">
        <MenuSubmenu>
          <MenuSubmenuTrigger
            icon={<FontAwesomeIcon icon={faPaperclip} className="w-3.5 h-3.5" />}
            chevron={<ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />}
            title={t('Attach files or a folder')}
          >
            {t('Attach')}
          </MenuSubmenuTrigger>
          <MenuContent alignOffset={-6} className="w-44">
            <MenuItem
              icon={<FileSearch className="w-3.5 h-3.5" strokeWidth={2} />}
              onClick={() => onSelectAttachment()}
              title={t('Attach files')}
            >
              {t('Files')}
            </MenuItem>
            <MenuItem
              icon={<FontAwesomeIcon icon={faFolder} className="w-3.5 h-3.5" />}
              onClick={() => onSelectFolderAttachment()}
              title={t('Attach a folder (uploaded with its structure)')}
            >
              {t('Folder')}
            </MenuItem>
          </MenuContent>
        </MenuSubmenu>
        {sessionSubmenu(
          'claude-code',
          onImportSession ? t('Continue a Claude Code session') : t('Claude Code session'),
          t('Claude Code sessions'),
          ClaudeCodeIcon,
        )}
        {sessionSubmenu(
          'codex',
          onImportSession ? t('Continue a Codex session') : t('Codex session'),
          t('Codex sessions'),
          CodexIcon,
        )}
        {bypassControl && (
          <PermissionsSubmenu control={bypassControl} defaultOpen={open === 'permissions'} />
        )}
      </MenuContent>
    </Menu>
  )
}

/** How commands are authorized in this conversation: rarely changed, so in the + menu. */
function PermissionsSubmenu({
  control,
  defaultOpen,
}: {
  control: { active: boolean; onSelect: (bypass: boolean) => void }
  defaultOpen: boolean
}) {
  const Icon = control.active ? Unlock : Lock

  return (
    <MenuSubmenu defaultOpen={defaultOpen}>
      <MenuSubmenuTrigger
        icon={<Icon className="w-3.5 h-3.5" strokeWidth={2} />}
        chevron={<ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />}
        title={t('Choose how commands in this agent are authorized')}
      >
        {control.active ? t('Full Access') : t('Auto Mode')}
      </MenuSubmenuTrigger>
      <MenuContent alignOffset={-6} className="w-64">
        <MenuItem selected={!control.active} onClick={() => control.onSelect(false)}>
          <div className="flex flex-col">
            <span>{t('Auto Mode')}</span>
            <span className="text-[11px] text-tertiary">
              {t('Risky commands ask for your approval')}
            </span>
          </div>
        </MenuItem>
        <MenuItem selected={control.active} onClick={() => control.onSelect(true)}>
          <div className="flex flex-col">
            <span>{t('Full Access')}</span>
            <span className="text-[11px] text-tertiary">
              {t('Run every command without asking')}
            </span>
          </div>
        </MenuItem>
      </MenuContent>
    </MenuSubmenu>
  )
}

/** Shown by send while commands run without asking; Auto Mode, the usual, shows nothing. */
export function FullAccessMark() {
  return (
    <span
      role="img"
      aria-label={t('Full Access')}
      title={t(
        'Full Access: commands run without asking. Change it in the + menu or with /permissions.',
      )}
      className="flex h-7 w-5 shrink-0 items-center justify-center text-secondary"
    >
      <Unlock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </span>
  )
}
