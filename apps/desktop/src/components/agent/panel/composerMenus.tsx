import { faFolder, faPaperclip } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import {
  ChevronDown,
  ChevronRight,
  FileSearch,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react'

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
          <div className="px-2 py-2 text-[12px] text-error">Failed to load sessions</div>
        ) : loading && items.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-tertiary">Loading...</div>
        ) : items.length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-tertiary">No recent sessions</div>
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
      title={onImportSession ? 'Continue one of these on the selected agent' : title}
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
            : 'text-secondary hover:text-main hover:bg-zGray-800/60 data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main',
        )}
        title="Add attachment"
      >
        <Plus className="w-4 h-4" strokeWidth={2.2} />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-56">
        <MenuSubmenu>
          <MenuSubmenuTrigger
            icon={<FontAwesomeIcon icon={faPaperclip} className="w-3.5 h-3.5" />}
            chevron={<ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />}
            title="Attach files or a folder"
          >
            Attach
          </MenuSubmenuTrigger>
          <MenuContent alignOffset={-6} className="w-44">
            <MenuItem
              icon={<FileSearch className="w-3.5 h-3.5" strokeWidth={2} />}
              onClick={() => onSelectAttachment()}
              title="Attach files"
            >
              Files
            </MenuItem>
            <MenuItem
              icon={<FontAwesomeIcon icon={faFolder} className="w-3.5 h-3.5" />}
              onClick={() => onSelectFolderAttachment()}
              title="Attach a folder (uploaded with its structure)"
            >
              Folder
            </MenuItem>
          </MenuContent>
        </MenuSubmenu>
        {sessionSubmenu(
          'claude-code',
          onImportSession ? 'Continue a Claude Code session' : 'Claude Code session',
          'Claude Code sessions',
          ClaudeCodeIcon,
        )}
        {sessionSubmenu(
          'codex',
          onImportSession ? 'Continue a Codex session' : 'Codex session',
          'Codex sessions',
          CodexIcon,
        )}
      </MenuContent>
    </Menu>
  )
}

export function BypassControlMenu({
  bypassControl,
  hero,
}: {
  bypassControl: { active: boolean; onSelect: (bypass: boolean) => void }
  hero: boolean
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Authorization mode"
        className={clsx(
          'flex items-center gap-1.5 flex-shrink-0 rounded-full transition-colors',
          hero ? 'h-8 px-3' : 'h-7 px-2.5',
          'text-secondary hover:text-main hover:bg-zGray-800/60',
        )}
        title="Choose how commands in this conversation are authorized"
      >
        {bypassControl.active ? (
          <ShieldOff className="w-3.5 h-3.5" strokeWidth={2} />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />
        )}
        <span className="text-[12.5px] font-medium">
          {bypassControl.active ? 'Full Access' : 'Auto Mode'}
        </span>
        <ChevronDown className="w-3 h-3 opacity-60" strokeWidth={2} />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-64">
        <MenuItem
          icon={<ShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />}
          selected={!bypassControl.active}
          onClick={() => bypassControl.onSelect(false)}
        >
          <div className="flex flex-col">
            <span>Auto Mode</span>
            <span className="text-[11px] text-tertiary">Risky commands ask for your approval</span>
          </div>
        </MenuItem>
        <MenuItem
          icon={<ShieldOff className="w-3.5 h-3.5" strokeWidth={2} />}
          selected={bypassControl.active}
          onClick={() => bypassControl.onSelect(true)}
        >
          <div className="flex flex-col">
            <span>Full Access</span>
            <span className="text-[11px] text-tertiary">Run every command without asking</span>
          </div>
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
