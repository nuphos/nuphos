import { Check, ChevronRight } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../../i18n'
import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices, offeredDefaultModel } from '../../../lib/modelChoices'
import { claudeModelGroups, isClaudeCatalog } from '../../../lib/modelGroups'
import {
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
} from '../../ui/menu'

import { ModelRow } from './ModelRow'

import type { SessionConfigOption } from '../../../api/session-config-types'
import type { ReactNode } from 'react'

/**
 * The model list. Claude chats number the newest model of each family for the
 * keyboard and keep older ones under "More models"; Codex chats list a Default
 * row when the runtime offers one, then every model.
 */
export function ModelMenu({
  model,
  blocked,
  onSelect,
  onBack,
  footer,
}: {
  model: SessionConfigOption
  blocked: boolean
  onSelect: (value: string) => void
  /** Back to the effort view. */
  onBack?: () => void
  footer?: ReactNode
}) {
  const { choices, current } = concreteModelChoices(
    model.options.map((choice) => ({ ...choice, id: choice.value })),
    model.currentValue,
  )
  const olderRef = useRef<HTMLDivElement>(null)
  const claude = isClaudeCatalog(model.options)
  const inherited = claude ? undefined : offeredDefaultModel(model.options)
  const onDefault = model.currentValue === inherited?.value
  const { latest, older } = claude
    ? claudeModelGroups(choices, modelChoiceLabel)
    : { latest: choices, older: [] }
  const row = (choice: (typeof choices)[number], hint?: string) => (
    <ModelRow
      key={choice.id}
      label={modelChoiceLabel(choice)}
      description={choice.description}
      hint={hint}
      checked={!onDefault && choice.id === current}
      disabled={blocked}
      onSelect={() => onSelect(choice.value)}
    />
  )

  return (
    <div
      onKeyDown={(event) => {
        // Keys pressed in "More models" reach here through its portal; those are its own.
        if (!event.currentTarget.contains(event.target as Node)) return
        const numbered = claude && /^[1-9]$/.test(event.key) && latest[Number(event.key) - 1]

        if (event.key === 'ArrowLeft' && onBack) onBack()
        else if (numbered && !blocked && !event.metaKey && !event.ctrlKey && !event.altKey)
          onSelect(numbered.value)
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <MenuGroup>
        <MenuGroupLabel className="text-xs font-normal normal-case tracking-normal">
          {t('Select model')}
        </MenuGroupLabel>
        {inherited && (
          <ModelRow
            label={t('Default')}
            description={inherited.description || t('Recommended set of models')}
            inline
            checked={onDefault}
            disabled={blocked}
            onSelect={() => onSelect(inherited.value)}
          />
        )}
        {latest.map((choice, index) => row(choice, claude ? String(index + 1) : undefined))}
      </MenuGroup>
      {older.length > 0 && (
        <>
          <MenuSeparator />
          <MenuSubmenu
            // Move into the list as it opens, so ↑/↓ and ← act on it.
            onOpenChangeComplete={(shown) => {
              const list = olderRef.current

              if (!shown || !list || list.contains(document.activeElement)) return
              const row =
                list.querySelector<HTMLElement>('[aria-checked="true"]') ??
                list.querySelector<HTMLElement>('[role="menuitemcheckbox"]')

              row?.focus()
            }}
          >
            <MenuSubmenuTrigger chevron={<ChevronRight size={14} />}>
              <span className="flex items-center gap-2">
                <span className="flex-1">{t('More models')}</span>
                {older.some((choice) => choice.id === current) && (
                  <Check size={14} strokeWidth={2.4} aria-label={t('Current model is here')} />
                )}
              </span>
            </MenuSubmenuTrigger>
            <MenuContent ref={olderRef} side="right" align="start" sideOffset={8} className="w-56">
              {older.map((choice) => row(choice))}
            </MenuContent>
          </MenuSubmenu>
        </>
      )}
      {footer}
    </div>
  )
}
