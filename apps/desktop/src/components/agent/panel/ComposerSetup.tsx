import clsx from 'clsx'
import { ChevronRight, MoreHorizontal } from 'lucide-react'

import { t } from '../../../i18n'
import { effortLabel } from '../../../lib/configLabels'
import { resolvedEffort } from '../../../lib/effortStops'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
} from '../../ui/menu'

import { CredentialSelectionList } from './CredentialSelectorButton'
import { countSelectedCredentials } from './credentialSelectorButtonCounts'
import { ModelMenu } from './ModelMenu'
import { effortName, modelName } from './modelSelectorParts'
import { RuntimeSelector } from './RuntimeSelector'

import type { CredentialSelectorControl } from './credentialSections'
import type { ModelControl } from './ModelSelector'
import type { RuntimeControl } from './RuntimeSelector'
import type { ReactNode } from 'react'

/** A menu row: what it changes, and its current value in a quiet tone. */
function Entry({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <span className="flex items-center justify-between gap-6">
      <span>{label}</span>
      {value != null && value !== '' && <span className="truncate text-tertiary">{value}</span>}
    </span>
  )
}

/** A choice with a line saying what it means. */
function Described({ title, description }: { title: string; description: string }) {
  return (
    <span className="flex flex-col">
      <span>{title}</span>
      <span className="text-[11px] text-tertiary">{description}</span>
    </span>
  )
}

/**
 * The rest of the agent's setup behind one ⋯. People set it once, so it doesn't
 * show at rest; the runtime banner still speaks up when something is wrong. Each
 * setting opens as a submenu on hover, the way the runtime list opens a computer.
 */
export function ComposerSetup({
  hero,
  credentialSelector,
  bypassControl,
  modelControl,
  readOnly,
}: {
  hero: boolean
  credentialSelector?: CredentialSelectorControl
  bypassControl?: { active: boolean; onSelect: (bypass: boolean) => void }
  modelControl?: ModelControl
  readOnly: boolean
}) {
  const options = modelControl?.data?.options
  const model = options?.find((option) => option.kind === 'model')
  const effort = options?.find((option) => option.kind === 'effort')
  const effortLevel = effort && resolvedEffort(effort.options, effort.currentValue)
  const select = (configId: string, value: string) => modelControl?.select({ configId, value })

  return (
    <Menu>
      <MenuTrigger
        disabled={readOnly}
        aria-label={t('Agent settings')}
        title={t('Agent settings')}
        className={clsx(
          'flex cursor-pointer items-center justify-center rounded-lg text-tertiary outline-none transition-colors hover:bg-state-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-line-focus data-[popup-open]:bg-state-selected data-[popup-open]:text-primary',
          hero ? 'size-8' : 'size-7',
        )}
      >
        <MoreHorizontal className="size-4" strokeWidth={1.75} />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-64">
        {model && (
          <MenuSubmenu>
            <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
              <Entry label={t('Model')} value={modelName(model)} />
            </MenuSubmenuTrigger>
            <MenuContent className="w-72">
              <ModelMenu
                model={model}
                blocked={Boolean(modelControl?.saving)}
                onSelect={(value) => select(model.id, value)}
              />
            </MenuContent>
          </MenuSubmenu>
        )}
        {effort && (
          <MenuSubmenu>
            <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
              <Entry label={t('Effort')} value={effortName(effort)} />
            </MenuSubmenuTrigger>
            <MenuContent className="w-48">
              {effort.options.map((choice) => (
                <MenuItem
                  key={choice.value}
                  selected={choice.value === effortLevel}
                  onClick={() => select(effort.id, choice.value)}
                >
                  {effortLabel(choice)}
                </MenuItem>
              ))}
            </MenuContent>
          </MenuSubmenu>
        )}
        {bypassControl && (
          <MenuSubmenu>
            <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
              <Entry
                label={t('Permissions')}
                value={bypassControl.active ? t('Full Access') : t('Auto Mode')}
              />
            </MenuSubmenuTrigger>
            <MenuContent className="w-64">
              <MenuItem
                selected={!bypassControl.active}
                onClick={() => bypassControl.onSelect(false)}
              >
                <Described
                  title={t('Auto Mode')}
                  description={t('Risky commands ask for your approval')}
                />
              </MenuItem>
              <MenuItem
                selected={bypassControl.active}
                onClick={() => bypassControl.onSelect(true)}
              >
                <Described
                  title={t('Full Access')}
                  description={t('Run every command without asking')}
                />
              </MenuItem>
            </MenuContent>
          </MenuSubmenu>
        )}
        {credentialSelector && (
          <>
            <MenuSubmenu>
              <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
                <Entry
                  label={t('Connectors')}
                  value={countSelectedCredentials(credentialSelector.value)}
                />
              </MenuSubmenuTrigger>
              <MenuContent className="w-[340px]">
                <CredentialSelectionList {...credentialSelector} personalIdentity devices={false} />
              </MenuContent>
            </MenuSubmenu>
            <MenuSubmenu>
              <MenuSubmenuTrigger chevron={<ChevronRight className="h-3 w-3" />}>
                <Entry label={t('Computers')} value={credentialSelector.value.deviceIds.length} />
              </MenuSubmenuTrigger>
              <MenuContent className="w-[340px]">
                <CredentialSelectionList {...credentialSelector} devices />
              </MenuContent>
            </MenuSubmenu>
          </>
        )}
      </MenuContent>
    </Menu>
  )
}

/** Where the agent runs, always in view; it opens the runtime list in place. */
export function ComposerRuntime({
  runtimeControl,
  menuOpen,
  onMenuOpenChange,
  hero,
}: {
  runtimeControl: RuntimeControl
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  hero: boolean
}) {
  return (
    <RuntimeSelector
      {...runtimeControl}
      menuOpen={menuOpen}
      onMenuOpenChange={onMenuOpenChange}
      hero={hero}
      line
    />
  )
}
