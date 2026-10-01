import { Trash2 } from 'lucide-react'

import { AppSelect } from '../../components/ui/select'

import { ReadOnlyEditableCell } from './env-cells'
import { resetEnvRowSource } from './env-model'
import {
  envCheckboxClass,
  envInputClass,
  envSelectTriggerClass,
  envSourceOptions,
  sourceLabel,
} from './env-options'
import { readonlyText } from './env-readonly-text'
import { envDetailColumn, envTargetColumn } from './env-value-columns'

import type { EnvColumnsContext } from './env-columns-context'
import type { EditableDeploymentEnvSource, EnvTableRow } from './env-model'
import type { Column } from '../../components/Table'

export function buildEnvColumns(ctx: EnvColumnsContext): Column<EnvTableRow>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      width: 220,
      render: (item) => {
        if (item.kind === 'unknown') {
          return (
            <span className="block truncate font-mono text-secondary" title={item.entry.name}>
              {item.entry.name}
            </span>
          )
        }
        if (!ctx.editing('env', item.row.id, 'name')) {
          return (
            <ReadOnlyEditableCell
              onEdit={() =>
                ctx.setEditingCell({ table: 'env', rowId: item.row.id, column: 'name' })
              }
            >
              {readonlyText(item.row.name, { mono: true })}
            </ReadOnlyEditableCell>
          )
        }

        return (
          <input
            autoFocus
            value={item.row.name}
            onChange={(event) => ctx.updateEnvRow(item.row.id, { name: event.target.value })}
            onBlur={ctx.closeEditing}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
          />
        )
      },
    },
    {
      key: 'source',
      header: 'Source',
      width: 170,
      render: (item) => {
        if (item.kind === 'unknown')
          return <span className="text-secondary">{sourceLabel(item.entry.source)}</span>
        if (!ctx.editing('env', item.row.id, 'source')) {
          return (
            <ReadOnlyEditableCell
              onEdit={() =>
                ctx.setEditingCell({ table: 'env', rowId: item.row.id, column: 'source' })
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
              const source = value as EditableDeploymentEnvSource

              if (!ctx.selectedKey) return
              ctx.updateDraft(ctx.selectedKey, {
                ...ctx.selectedDraft,
                env: ctx.selectedDraft.env.map((row) =>
                  row.id === item.row.id ? resetEnvRowSource(row, source) : row,
                ),
              })
              ctx.closeEditing()
            }}
            options={envSourceOptions}
            triggerClassName={envSelectTriggerClass}
          />
        )
      },
    },
    envTargetColumn(ctx),
    envDetailColumn(ctx),
    {
      key: 'optional',
      header: 'Optional',
      width: 100,
      render: (item) => {
        if (
          item.kind === 'unknown' ||
          (item.row.source !== 'configMapKeyRef' && item.row.source !== 'secretKeyRef')
        ) {
          return null
        }
        if (!ctx.editing('env', item.row.id, 'optional')) {
          return (
            <ReadOnlyEditableCell
              align="center"
              onEdit={() =>
                ctx.setEditingCell({ table: 'env', rowId: item.row.id, column: 'optional' })
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
                ctx.updateEnvRow(item.row.id, { optional: event.target.checked })
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
                env: ctx.selectedDraft.env.filter((row) => row.id !== item.row.id),
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
