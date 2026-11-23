import clsx from 'clsx'
import {
  Paperclip as PaperclipIcon,
  Folder as FolderIcon,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Lock,
  Plus,
  Unlock,
} from 'lucide-react'

import { t } from '../../../i18n'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'
import { UiIcon } from '../../ui/ui-icon'
import { SummaryMenuRow } from '../summary/ChatSummaryRows'

import { ClaudeCodeIcon, CodexIcon } from './icons'
import { SessionSubmenu } from './SessionSubmenu'

import type { LocalAgentSessionInfo, LocalSessionSource } from '../../../api'
import type { ReactNode, SVGProps } from 'react'

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
}: {
  open: boolean
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
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
        disabled={readOnly}
        className={clsx(
          hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
          'flex items-center justify-center transition-colors flex-shrink-0',
          readOnly
            ? 'text-tertiary'
            : 'text-secondary hover:text-main hover:bg-state-hover data-[popup-open]:bg-state-selected data-[popup-open]:text-main',
        )}
        title={t('Add attachment')}
      >
        <Plus className="w-4 h-4" strokeWidth={2.2} />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-56">
        <MenuSubmenu>
          <MenuSubmenuTrigger
            icon={<UiIcon size={14} icon={PaperclipIcon} className="w-3.5 h-3.5" />}
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
              icon={<UiIcon size={14} icon={FolderIcon} className="w-3.5 h-3.5" />}
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
      </MenuContent>
    </Menu>
  )
}

export function BypassControlMenu({
  bypassControl,
  hero,
  asRow,
}: {
  /** active is undefined until the task's own mode is known. */
  bypassControl: { active: boolean | undefined; onSelect: (bypass: boolean) => void }
  hero: boolean
  /** A row of a details panel, opening the menu under it, instead of a composer chip. */
  asRow?: boolean
}) {
  const { active } = bypassControl
  // Both labels always share one cell, the inactive one unseen, so the chip is
  // always the wider label's width: nothing moves when the mode arrives or changes.
  // Until it is known the whole chip is unseen too: no wrong mode shows.

  return (
    <Menu>
      {asRow ? (
        <SummaryMenuRow
          aria-label={t('Authorization mode')}
          className={clsx(active === undefined && 'invisible')}
          title={t('Choose how commands in this task are authorized')}
          icon={
            active ? (
              <Unlock className="size-3.5" strokeWidth={1.8} />
            ) : (
              <Lock className="size-3.5" strokeWidth={1.8} />
            )
          }
          label={active ? t('Full Access') : t('Auto Mode')}
          note={<ChevronDown className="size-3.5" strokeWidth={1.8} />}
        />
      ) : (
        <MenuTrigger
          aria-label={t('Authorization mode')}
          aria-hidden={active === undefined || undefined}
          className={clsx(
            'hidden @[210px]:flex items-center gap-1.5 flex-shrink-0 rounded-full transition-colors',
            hero ? 'h-8 px-1.5 @[400px]:px-3' : 'h-7 px-1.5 @[400px]:px-2.5',
            'text-secondary hover:text-main hover:bg-state-hover',
            active === undefined && 'invisible',
          )}
          title={t('Choose how commands in this task are authorized')}
        >
          <span className="grid text-[12.5px] font-medium">
            {[true, false].map((full) => (
              <span
                key={String(full)}
                aria-hidden={full !== active || undefined}
                className={clsx(
                  'col-start-1 row-start-1 flex items-center',
                  full !== active && 'invisible',
                )}
              >
                {full ? (
                  <Unlock className="w-3.5 h-3.5 @[400px]:hidden" strokeWidth={2} aria-hidden />
                ) : (
                  <Lock className="w-3.5 h-3.5 @[400px]:hidden" strokeWidth={2} aria-hidden />
                )}
                <span className="hidden @[400px]:inline @[520px]:hidden">
                  {full ? t('Full') : t('Auto')}
                </span>
                <span className="hidden @[520px]:inline">
                  {full ? t('Full Access') : t('Auto Mode')}
                </span>
              </span>
            ))}
          </span>
          <ChevronDown className="w-3 h-3 opacity-60 hidden @[400px]:block" strokeWidth={2} />
        </MenuTrigger>
      )}
      <MenuContent side={asRow ? 'bottom' : 'top'} align={asRow ? 'end' : 'start'} className="w-64">
        <MenuItem selected={active === false} onClick={() => bypassControl.onSelect(false)}>
          <div className="flex flex-col">
            <span>{t('Auto Mode')}</span>
            <span className="text-[11px] text-tertiary">
              {t('Risky commands ask for your approval')}
            </span>
          </div>
        </MenuItem>
        <MenuItem selected={active === true} onClick={() => bypassControl.onSelect(true)}>
          <div className="flex flex-col">
            <span>{t('Full Access')}</span>
            <span className="text-[11px] text-tertiary">
              {t('Run every command without asking')}
            </span>
          </div>
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
