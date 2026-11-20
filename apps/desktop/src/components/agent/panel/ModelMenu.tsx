import { t } from '../../../i18n'
import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices } from '../../../lib/modelChoices'
import { claudeModelGroups, isClaudeCatalog } from '../../../lib/modelGroups'
import { MenuGroup, MenuGroupLabel } from '../../ui/menu'

import { ModelRow } from './ModelRow'
import { splitProvider } from './modelSelectorParts'

import type { SessionConfigOption } from '../../../api/session-config-types'

/**
 * The model list. Claude chats number the newest model of each family for the
 * keyboard and list older ones in a "More models" group at the end; other
 * runtimes list every model, grouped under the provider its name starts with
 * ("OpenCode/Big Pickle"). A runtime's "Default" alias is never a row: the list
 * checks the model it runs.
 */
export function ModelMenu({
  model,
  blocked,
  onSelect,
}: {
  model: SessionConfigOption
  blocked: boolean
  onSelect: (value: string) => void
}) {
  const { choices, current } = concreteModelChoices(
    model.options.map((choice) => ({ ...choice, id: choice.value })),
    model.currentValue,
  )
  const claude = isClaudeCatalog(model.options)
  const { latest, older } = claude
    ? claudeModelGroups(choices, modelChoiceLabel)
    : { latest: choices, older: [] }
  const groups = new Map<string, typeof latest>()

  for (const choice of latest) {
    const [provider] = splitProvider(choice.name)

    groups.set(provider, [...(groups.get(provider) ?? []), choice])
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
      {[...groups].map(([provider, rows]) => (
        <MenuGroup key={provider}>
          <MenuGroupLabel className="text-xs font-normal normal-case tracking-normal">
            {provider || t('Select model')}
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
    </div>
  )
}
