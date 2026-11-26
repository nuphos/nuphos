import { Plug } from 'lucide-react'

import { openInApp } from '../../../app/workspace/openInApp'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { t } from '../../../i18n'
import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices } from '../../../lib/modelChoices'
import { claudeModelGroups, isClaudeCatalog } from '../../../lib/modelGroups'
import { MenuGroup, MenuGroupLabel, MenuItem } from '../../ui/menu'

import { customProviderHost } from './customProviderHost'
import { ModelRow } from './ModelRow'
import { splitProvider } from './modelSelectorParts'

import type { SessionConfigOption } from '../../../api/session-config-types'

/**
 * The model list. Claude chats number the newest model of each family for the
 * keyboard and list older ones in a "More models" group at the end; other
 * runtimes list every model, grouped under the provider its name starts with
 * ("OpenCode/Big Pickle"). A runtime's "Default" alias is never a row: the list
 * checks the model it runs. Behind a custom provider the list is that provider's,
 * so it is one group named for its host, with the way to edit it.
 */
export function ModelMenu({
  model,
  blocked,
  onSelect,
  teamId,
  runtimeId,
}: {
  model: SessionConfigOption
  blocked: boolean
  onSelect: (value: string) => void
  teamId?: string
  runtimeId?: string
}) {
  const host = customProviderHost(useLocalRuntimeState(), runtimeId)
  const { choices, current } = concreteModelChoices(
    model.options.map((choice) => ({ ...choice, id: choice.value })),
    model.currentValue,
  )
  // A provider's own IDs are no Claude families to sort, but are numbered all the same.
  const claude = Boolean(host) || isClaudeCatalog(model.options)
  const { latest, older } =
    claude && !host ? claudeModelGroups(choices, modelChoiceLabel) : { latest: choices, older: [] }
  const groups = new Map<string, typeof latest>()

  for (const choice of latest) {
    const group = host ?? splitProvider(choice.name)[0]

    groups.set(group, [...(groups.get(group) ?? []), choice])
  }
  const row = (choice: (typeof choices)[number], hint?: string) => (
    <ModelRow
      key={choice.id}
      label={splitProvider(modelChoiceLabel(choice))[1]}
      description={choice.description}
      hint={hint}
      checked={choice.id === current}
      disabled={blocked}
      onSelect={() => onSelect(choice.value)}
    />
  )

  return (
    <div
      onKeyDown={(event) => {
        const numbered = claude && /^[1-9]$/.test(event.key) && latest[Number(event.key) - 1]

        if (!numbered || blocked || event.metaKey || event.ctrlKey || event.altKey) return
        onSelect(numbered.value)
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {[...groups].map(([group, rows]) => (
        <MenuGroup key={group}>
          <MenuGroupLabel className="flex justify-between gap-3 text-xs font-normal normal-case tracking-normal">
            {group || t('Select model')}
            {host && <span>{t('Custom provider')}</span>}
          </MenuGroupLabel>
          {rows.map((choice) =>
            row(choice, claude ? String(latest.indexOf(choice) + 1) : undefined),
          )}
        </MenuGroup>
      ))}
      {older.length > 0 && (
        <MenuGroup>
          <MenuGroupLabel className="text-xs font-normal normal-case tracking-normal">
            {t('More models')}
          </MenuGroupLabel>
          {older.map((choice) => row(choice))}
        </MenuGroup>
      )}
      {host && teamId && (
        <MenuGroup className="border-t border-line-control/60">
          <MenuItem
            icon={<Plug size={13} />}
            // Settings › Computers, where this computer's custom provider is edited.
            onClick={() => openInApp(`/teams/${encodeURIComponent(teamId)}/agents`)}
          >
            {t('Edit custom provider…')}
          </MenuItem>
        </MenuGroup>
      )}
    </div>
  )
}
