import clsx from 'clsx'
import { Loader2, Shield, X } from 'lucide-react'
import { useState } from 'react'

import { Menu, MenuContent, MenuTrigger } from '../../ui/menu'

import { allCredentialAccess, emptyCredentialAccess } from './credentialAccess'
import { hasUnseenCredentials } from './credentialFreshness'
import { countSelectedCredentials, countTotalCredentials } from './credentialSelectorButtonCounts'
import { useCredentialSections } from './credentialSelectorButtonHooks'
import { CredentialSelectorSectionList } from './credentialSelectorButtonSections'

import type { CredentialSelectorControl } from './credentialSections'

export function CredentialSelectorButton({
  options,
  value,
  saving,
  unseen,
  onOpen,
  onChange,
  hero,
  positionerClassName,
}: CredentialSelectorControl & { hero: boolean; positionerClassName?: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const selectedCount = countSelectedCredentials(value)
  const totalCount = countTotalCredentials(options)
  const sections = useCredentialSections(options)
  const hasNew = hasUnseenCredentials(unseen)

  return (
    <Menu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open)
        if (open) onOpen()
      }}
    >
      <MenuTrigger
        className={clsx(
          // Both variants are the same icon button — a shield with a count —
          // sized to match the `+` beside them. The hero composer used to spell
          // the selection out as provider logos, which grew and shrank the
          // control as credentials were picked and said little the count does
          // not.
          'relative flex flex-shrink-0 items-center justify-center gap-1.5 transition-colors text-secondary hover:text-main hover:bg-zGray-800/60 data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main',
          hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
        )}
        title={`Agent credentials (${String(selectedCount)}/${String(totalCount)} selected)${hasNew ? ' · new credentials available' : ''}`}
        aria-label="Agent credentials"
      >
        <span className="t-icon-swap h-3.5 w-3.5" data-state={saving ? 'b' : 'a'}>
          <span className="t-icon flex h-3.5 w-3.5 items-center justify-center" data-icon="a">
            <Shield className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="t-icon flex h-3.5 w-3.5 items-center justify-center" data-icon="b">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          </span>
        </span>
        <span
          key={selectedCount}
          className="absolute -right-1 -top-1 flex min-w-3.5 h-3.5 items-center justify-center rounded-full bg-zViolet-accent px-0.5 text-[9.5px] text-white font-medium leading-none transition-[transform,opacity,background-color] duration-150 ease-out"
        >
          {selectedCount}
        </span>
        {hasNew && (
          <span
            aria-hidden
            className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-zViolet-accent"
          />
        )}
      </MenuTrigger>
      <MenuContent
        side="top"
        align="start"
        className="w-[340px]"
        positionerClassName={positionerClassName}
      >
        <div className="px-2 pt-1 pb-2 flex items-center gap-2 border-b border-zGray-800/60 mb-1.5">
          <Shield className="h-3.5 w-3.5 text-tertiary" strokeWidth={1.8} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-main">Agent credentials</div>
            <div className="text-[11.5px] text-tertiary">
              {selectedCount}/{totalCount} selected
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="h-6 w-6 rounded-md text-tertiary hover:text-main hover:bg-zGray-800 flex items-center justify-center"
            title="Close"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
        {totalCount === 0 && (
          <div className="px-2 py-3 text-[12px] text-tertiary">
            No credentials bound to this team yet.
          </div>
        )}
        {totalCount > 0 && (
          <div className="px-2 pb-1.5 mb-1 flex items-center gap-2 border-b border-zGray-800/60">
            <button
              type="button"
              onClick={() => onChange(allCredentialAccess(options))}
              disabled={selectedCount === totalCount}
              className="text-[11.5px] text-zViolet-accent hover:underline disabled:text-tertiary disabled:no-underline disabled:cursor-default"
            >
              Select all
            </button>
            <span className="text-tertiary text-[11px]">·</span>
            <button
              type="button"
              onClick={() => onChange(emptyCredentialAccess())}
              disabled={selectedCount === 0}
              className="text-[11.5px] text-secondary hover:text-main hover:underline disabled:text-tertiary disabled:no-underline disabled:cursor-default"
            >
              Clear all
            </button>
          </div>
        )}
        <CredentialSelectorSectionList
          sections={sections}
          value={value}
          unseen={unseen}
          onChange={onChange}
        />
      </MenuContent>
    </Menu>
  )
}
