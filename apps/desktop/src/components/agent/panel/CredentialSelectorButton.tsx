import clsx from 'clsx'
import { Laptop, Loader2, Shield, X } from 'lucide-react'
import { useState } from 'react'

import { Menu, MenuCheckboxItem, MenuContent, MenuTrigger } from '../../ui/menu'

import { allCredentialAccess, emptyCredentialAccess } from './credentialAccess'
import { buildDeviceCredentialSections } from './credentialSections'
import { countSelectedCredentials, countTotalCredentials } from './credentialSelectorButtonCounts'
import { useCredentialSections } from './credentialSelectorButtonHooks'
import { CredentialSelectorSectionList } from './credentialSelectorButtonSections'

import type { CredentialSelectorControl } from './credentialSections'

type SelectorProps = CredentialSelectorControl & { hero: boolean; positionerClassName?: string }

export function CredentialSelectorButton(props: SelectorProps) {
  return (
    <>
      <SelectionButton {...props} devices={false} />
      <SelectionButton {...props} devices />
    </>
  )
}

function SelectionButton({
  options,
  value,
  saving,
  unseen,
  onOpen,
  onChange,
  hero,
  positionerClassName,
  devices,
}: SelectorProps & { devices: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const selectedCount = devices ? value.deviceIds.length : countSelectedCredentials(value)
  const totalCount = devices ? options.devices.length : countTotalCredentials(options)
  const sections = useCredentialSections(options)
  const hasNew =
    unseen !== undefined &&
    (devices ? unseen.deviceIds.length > 0 : countSelectedCredentials(unseen) > 0)
  const title = devices ? 'Devices' : 'Agent credentials'
  const Icon = devices ? Laptop : Shield
  const iconSize = devices ? 'h-4 w-4' : 'h-3.5 w-3.5'
  const changeAll = (select: boolean) => {
    const next = select ? allCredentialAccess(options) : emptyCredentialAccess()

    onChange(
      devices ? { ...value, deviceIds: next.deviceIds } : { ...next, deviceIds: value.deviceIds },
    )
  }

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
          'relative flex flex-shrink-0 items-center justify-center gap-1.5 transition-colors text-secondary hover:text-main hover:bg-zGray-800/60 data-[popup-open]:bg-zGray-800/60 data-[popup-open]:text-main',
          hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
        )}
        title={`${title} (${String(selectedCount)}/${String(totalCount)} selected)${hasNew ? ' · new options available' : ''}`}
        aria-label={title}
      >
        <Icon className={iconSize} strokeWidth={devices ? 1.75 : 2} />
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
          <Icon className={clsx(iconSize, 'text-tertiary')} strokeWidth={devices ? 1.575 : 1.8} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-main">{title}</div>
            <div className="text-[11.5px] text-tertiary">
              {selectedCount}/{totalCount} selected
            </div>
          </div>
          {saving && (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-tertiary"
              aria-label="Updating selection"
            />
          )}
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
            {devices
              ? 'No devices available to this team yet.'
              : 'No credentials bound to this team yet.'}
          </div>
        )}
        {totalCount > 0 && (
          <div className="px-2 pb-1.5 mb-1 flex items-center gap-2 border-b border-zGray-800/60">
            <button
              type="button"
              onClick={() => changeAll(true)}
              disabled={selectedCount === totalCount}
              className="text-[11.5px] text-zViolet-accent hover:underline disabled:text-tertiary disabled:no-underline disabled:cursor-default"
            >
              Select all
            </button>
            <span className="text-tertiary text-[11px]">·</span>
            <button
              type="button"
              onClick={() => changeAll(false)}
              disabled={selectedCount === 0}
              className="text-[11.5px] text-secondary hover:text-main hover:underline disabled:text-tertiary disabled:no-underline disabled:cursor-default"
            >
              Clear all
            </button>
          </div>
        )}
        {devices ? (
          <DeviceOptions options={options} value={value} unseen={unseen} onChange={onChange} />
        ) : (
          <CredentialSelectorSectionList
            sections={sections}
            value={value}
            unseen={unseen}
            onChange={onChange}
          />
        )}
      </MenuContent>
    </Menu>
  )
}

function DeviceOptions({
  options,
  value,
  unseen,
  onChange,
}: Pick<CredentialSelectorControl, 'options' | 'value' | 'unseen' | 'onChange'>) {
  return (
    <>
      {buildDeviceCredentialSections(options.devices)
        .flatMap((section) => section.items)
        .map((device) => (
          <MenuCheckboxItem
            key={device.id}
            checked={value.deviceIds.includes(device.id)}
            onCheckedChange={(checked) =>
              onChange({
                ...value,
                deviceIds: checked
                  ? [...value.deviceIds, device.id]
                  : value.deviceIds.filter((id) => id !== device.id),
              })
            }
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-main">{device.label}</span>
              <span className="block text-[11.5px] text-tertiary">{device.sublabel}</span>
            </span>
            {unseen?.deviceIds.includes(device.id) && (
              <span className="text-[10px] text-zViolet-accent">New</span>
            )}
          </MenuCheckboxItem>
        ))}
    </>
  )
}
