import { Trash2 } from 'lucide-react'

import { AppSelect } from '../../components/ui/select'

import { EnvRefNavButton, ReadOnlyEditableCell } from './env-cells'
import {
  envCheckboxClass,
  envFromSourceOptions,
  envInputClass,
  envMonoSelectTriggerClass,
  envSelectTriggerClass,
  optionValues,
  refNamesForSource,
  selectOptions,
  sourceLabel,
} from './env-options'
import { readonlyText } from './env-readonly-text'

import type { EnvColumnsContext } from './env-columns-context'
import type { EnvFromDraftRow, EnvFromTableRow } from './env-model'
import type { Column } from '../../components/Table'

export function buildEnvFromColumns(ctx: EnvColumnsContext): Column<EnvFromTableRow>[] {
  return [
    {
      key: 'source',
      header: 'Source',
      width: 180,
      render: (item) => {
        if (item.kind === 'unknown')
          return <span className="text-secondary">{sourceLabel(item.entry.source)}</span>
        if (!ctx.editing('envFrom', item.row.id, 'source')) {
          return (
            <ReadOnlyEditableCell
              onEdit={() =>
                ctx.setEditingCell({ table: 'envFrom', rowId: item.row.id, column: 'source' })
              }
            >
              {readonlyText(sourceLabel(item.row.source))}
            </ReadOnlyEditableCell>
          )
        }

        return (
          <AppSelect
            autoFocus
            value={item.row.source}
            onOpenChange={(open) => {
              if (!open) ctx.closeEditing()
            }}
            onValueChange={(value) => {
              const source = value as EnvFromDraftRow['source']
              const names = refNamesForSource(source, ctx.configMaps, ctx.secrets)

              ctx.updateEnvFromRow(item.row.id, {
                source,
                name: names.includes(item.row.name) ? item.row.name : (names[0] ?? ''),
              })
              ctx.closeEditing()
            }}
            options={envFromSourceOptions}
            triggerClassName={envSelectTriggerClass}
          />
        )
      },
    },
    {
      key: 'name',
      header: 'Name',
      width: 300,
      render: (item) => {
        if (item.kind === 'unknown') {
          return (
            <span className="block truncate font-mono text-tertiary">{item.entry.name ?? '-'}</span>
          )
        }
        if (!ctx.editing('envFrom', item.row.id, 'name')) {
          return (
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1">
                <ReadOnlyEditableCell
                  onEdit={() =>
                    ctx.setEditingCell({ table: 'envFrom', rowId: item.row.id, column: 'name' })
                  }
                >
                  {readonlyText(item.row.name, { mono: true, muted: !item.row.name })}
                </ReadOnlyEditableCell>
              </div>
              {item.row.name ? (
                <EnvRefNavButton
                  kind={item.row.source === 'secretRef' ? 'Secret' : 'ConfigMap'}
                  namespace={ctx.namespace}
                  name={item.row.name}
                  onNavigate={ctx.onNavigate}
                />
              ) : null}
            </div>
          )
        }
        const refNameOptions = optionValues(
          refNamesForSource(item.row.source, ctx.configMaps, ctx.secrets),
          item.row.name,
        )

        return (
          <AppSelect
            autoFocus
            value={item.row.name}
            onOpenChange={(open) => {
              if (!open) ctx.closeEditing()
            }}
            onValueChange={(name) => {
              ctx.updateEnvFromRow(item.row.id, { name })
              ctx.closeEditing()
            }}
            options={selectOptions(refNameOptions)}
            placeholder={item.row.source === 'secretRef' ? 'Select Secret' : 'Select ConfigMap'}
            triggerClassName={envMonoSelectTriggerClass}
          />
        )
      },
    },
    {
      key: 'prefix',
      header: 'Prefix',
      width: 220,
      render: (item) => {
        if (item.kind === 'unknown') {
          return (
            <span className="block truncate font-mono text-tertiary">
              {item.entry.prefix ?? '-'}
            </span>
          )
        }
        if (!ctx.editing('envFrom', item.row.id, 'prefix')) {
          return (
            <ReadOnlyEditableCell
              onEdit={() =>
                ctx.setEditingCell({ table: 'envFrom', rowId: item.row.id, column: 'prefix' })
              }
            >
              {readonlyText(item.row.prefix ?? '', { mono: true, muted: !item.row.prefix })}
            </ReadOnlyEditableCell>
          )
        }

        return (
          <input
            autoFocus
            value={item.row.prefix ?? ''}
            onChange={(event) => ctx.updateEnvFromRow(item.row.id, { prefix: event.target.value })}
            onBlur={ctx.closeEditing}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
            placeholder="prefix"
          />
        )
      },
    },
    {
      key: 'optional',
      header: 'Optional',
      width: 100,
      render: (item) => {
        if (item.kind === 'unknown') return null
        if (!ctx.editing('envFrom', item.row.id, 'optional')) {
          return (
            <ReadOnlyEditableCell
              align="center"
              onEdit={() =>
                ctx.setEditingCell({ table: 'envFrom', rowId: item.row.id, column: 'optional' })
              }
            >
              {readonlyText(item.row.optional ? 'Yes' : 'No', { muted: !item.row.optional })}
            </ReadOnlyEditableCell>
          )
        }

        return (
          <label className="flex h-8 items-center justify-center">
            <input
              autoFocus
              type="checkbox"
              checked={Boolean(item.row.optional)}
              onChange={(event) => {
                ctx.updateEnvFromRow(item.row.id, { optional: event.target.checked })
                ctx.closeEditing()
              }}
              onBlur={ctx.closeEditing}
              className={envCheckboxClass}
            />
          </label>
        )
      },
    },
    {
      key: 'actions',
      header: '',
      width: 56,
      render: (item) => {
        if (item.kind === 'unknown') return null

        return (
          <button
            type="button"
            onClick={() => {
              if (!ctx.selectedKey) return
              ctx.updateDraft(ctx.selectedKey, {
                ...ctx.selectedDraft,
                envFrom: ctx.selectedDraft.envFrom.filter((row) => row.id !== item.row.id),
              })
            }}
            className="flex h-8 w-8 items-center justify-center rounded text-tertiary hover:bg-zGray-800 hover:text-error"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )
      },
    },
  ]
}
