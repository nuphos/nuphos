import { AppSelect } from '../../components/ui/select'

import { EnvRefNavButton, ReadOnlyEditableCell } from './env-cells'
import {
  envInputClass,
  envMonoSelectTriggerClass,
  keyNamesForRef,
  optionValues,
  refNamesForSource,
  selectOptions,
} from './env-options'
import { readonlyText } from './env-readonly-text'

import type { EnvColumnsContext } from './env-columns-context'
import type { EnvTableRow } from './env-model'
import type { Column } from '../../components/Table'

export function envTargetColumn(ctx: EnvColumnsContext): Column<EnvTableRow> {
  return {
    key: 'target',
    header: 'Target',
    width: 300,
    render: (item) => {
      if (item.kind === 'unknown') {
        return (
          <span className="block truncate font-mono text-tertiary" title={item.entry.sourceLabel}>
            {item.entry.sourceLabel}
          </span>
        )
      }
      const row = item.row

      if (!ctx.editing('env', row.id, 'target')) {
        let value = ''

        if (row.source === 'value') value = row.value ?? ''
        if (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef')
          value = row.refName ?? ''
        if (row.source === 'fieldRef') value = row.fieldPath ?? ''
        if (row.source === 'resourceFieldRef') {
          value = [row.containerName, row.resource].filter(Boolean).join(' / ')
        }
        const isKeyRef = row.source === 'configMapKeyRef' || row.source === 'secretKeyRef'

        return (
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <ReadOnlyEditableCell
                onEdit={() => ctx.setEditingCell({ table: 'env', rowId: row.id, column: 'target' })}
              >
                {readonlyText(value, { mono: true, muted: !value, sensitive: true })}
              </ReadOnlyEditableCell>
            </div>
            {isKeyRef && value ? (
              <EnvRefNavButton
                kind={row.source === 'secretKeyRef' ? 'Secret' : 'ConfigMap'}
                namespace={ctx.namespace}
                name={value}
                onNavigate={ctx.onNavigate}
              />
            ) : null}
          </div>
        )
      }
      if (row.source === 'value') {
        return (
          <input
            autoFocus
            value={row.value ?? ''}
            onChange={(event) => ctx.updateEnvRow(row.id, { value: event.target.value })}
            onBlur={ctx.closeEditing}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
          />
        )
      }
      if (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') {
        const refNameOptions = optionValues(
          refNamesForSource(row.source, ctx.configMaps, ctx.secrets),
          row.refName,
        )

        return (
          <AppSelect
            autoFocus
            value={row.refName ?? ''}
            onOpenChange={(open) => {
              if (!open) ctx.closeEditing()
            }}
            onValueChange={(refName) => {
              const keys = keyNamesForRef(row.source, refName, ctx.configMaps, ctx.secrets)

              ctx.updateEnvRow(row.id, {
                refName,
                key: keys.includes(row.key ?? '') ? row.key : (keys[0] ?? ''),
              })
              ctx.closeEditing()
            }}
            options={selectOptions(refNameOptions)}
            placeholder={row.source === 'secretKeyRef' ? 'Select Secret' : 'Select ConfigMap'}
            triggerClassName={envMonoSelectTriggerClass}
          />
        )
      }
      if (row.source === 'fieldRef') {
        return (
          <input
            autoFocus
            value={row.fieldPath ?? ''}
            onChange={(event) => ctx.updateEnvRow(row.id, { fieldPath: event.target.value })}
            onBlur={ctx.closeEditing}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
            placeholder="metadata.name"
          />
        )
      }

      return (
        <div className="grid min-w-0 grid-cols-2 gap-2" onBlur={ctx.handleMultiFieldBlur}>
          <input
            autoFocus
            value={row.containerName ?? ''}
            onChange={(event) => ctx.updateEnvRow(row.id, { containerName: event.target.value })}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
            placeholder="container"
          />
          <input
            value={row.resource ?? ''}
            onChange={(event) => ctx.updateEnvRow(row.id, { resource: event.target.value })}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
            placeholder="limits.cpu"
          />
        </div>
      )
    },
  }
}

export function envDetailColumn(ctx: EnvColumnsContext): Column<EnvTableRow> {
  return {
    key: 'detail',
    header: 'Detail',
    width: 220,
    render: (item) => {
      if (item.kind === 'unknown') return null
      const row = item.row

      if (row.source === 'value') return <span className="text-tertiary">-</span>
      if (!ctx.editing('env', row.id, 'detail')) {
        let value = ''

        if (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') value = row.key ?? ''
        if (row.source === 'fieldRef') value = row.apiVersion ?? ''
        if (row.source === 'resourceFieldRef') value = row.divisor ?? ''

        return (
          <ReadOnlyEditableCell
            onEdit={() => ctx.setEditingCell({ table: 'env', rowId: row.id, column: 'detail' })}
          >
            {readonlyText(value, { mono: true, muted: !value })}
          </ReadOnlyEditableCell>
        )
      }
      if (row.source === 'configMapKeyRef' || row.source === 'secretKeyRef') {
        const keyNameOptions = optionValues(
          keyNamesForRef(row.source, row.refName, ctx.configMaps, ctx.secrets),
          row.key,
        )

        return (
          <AppSelect
            autoFocus
            value={row.key ?? ''}
            onOpenChange={(open) => {
              if (!open) ctx.closeEditing()
            }}
            onValueChange={(key) => {
              ctx.updateEnvRow(row.id, { key })
              ctx.closeEditing()
            }}
            options={selectOptions(keyNameOptions)}
            placeholder="Select key"
            triggerClassName={envMonoSelectTriggerClass}
          />
        )
      }
      if (row.source === 'fieldRef') {
        return (
          <input
            autoFocus
            value={row.apiVersion ?? ''}
            onChange={(event) => ctx.updateEnvRow(row.id, { apiVersion: event.target.value })}
            onBlur={ctx.closeEditing}
            onKeyDown={ctx.handleEditKeyDown}
            className={envInputClass}
            placeholder="apiVersion"
          />
        )
      }

      return (
        <input
          autoFocus
          value={row.divisor ?? ''}
          onChange={(event) => ctx.updateEnvRow(row.id, { divisor: event.target.value })}
          onBlur={ctx.closeEditing}
          onKeyDown={ctx.handleEditKeyDown}
          className={envInputClass}
          placeholder="divisor"
        />
      )
    },
  }
}
