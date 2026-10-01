import { AppSelect } from '../../components/ui/select'
import { Switch } from '../../components/ui/Switch'

import { RuntimeModelSelect } from './RuntimeModelSelect'

import type { useRuntimeModelCatalog } from './useRuntimeModelCatalog'
import type { RuntimeDefaults } from '../../types/runtime'

export function RuntimeDefaultsFields({
  value,
  onChange,
  disabled,
  discovery,
}: {
  value: RuntimeDefaults
  onChange: (value: RuntimeDefaults) => void
  disabled: boolean
  discovery: ReturnType<typeof useRuntimeModelCatalog>
}) {
  const controls = discovery.catalog?.controls
  const effort = controls?.effort ?? []
  const missingEffort = value.effort && !effort.some((option) => option.value === value.effort)

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <RuntimeModelSelect
        {...discovery}
        value={value.model}
        onChange={(model) => onChange({ ...value, model })}
        disabled={disabled}
      />
      <div className="min-w-0 space-y-2">
        <span className="block text-xs text-secondary">Effort</span>
        <AppSelect
          ariaLabel="Default effort"
          value={value.effort ? `effort:${value.effort}` : 'default'}
          options={[
            { value: 'default', label: 'Agent default' },
            ...effort.map((option) => ({ value: `effort:${option.value}`, label: option.name })),
            ...(missingEffort
              ? [
                  {
                    value: `effort:${value.effort}`,
                    label: value.effort!,
                    description: 'Saved effort · unavailable',
                  },
                ]
              : []),
          ]}
          triggerClassName="text-xs"
          disabled={disabled || (!effort.length && !value.effort)}
          onValueChange={(selection) =>
            onChange({ ...value, effort: selection === 'default' ? undefined : selection.slice(7) })
          }
        />
        {!effort.length && (
          <p className="text-[11px] leading-4 text-tertiary">
            {discovery.loading
              ? 'Loading options…'
              : controls
                ? 'Not supported by this model'
                : 'Options unavailable'}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <span className="block text-xs text-secondary">Fast mode</span>
        <div className="flex h-9 items-center gap-2">
          <Switch
            label="Default fast mode"
            checked={(value.fast ?? controls?.defaultFast) === 'on'}
            disabled={disabled || !controls?.fast}
            onChange={(checked) => onChange({ ...value, fast: checked ? 'on' : 'off' })}
          />
          <span className="text-xs text-secondary">
            {value.fast ? (value.fast === 'on' ? 'On' : 'Off') : 'Agent default'}
          </span>
        </div>
        {value.fast ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, fast: undefined })}
            className="text-[11px] text-secondary underline underline-offset-2 disabled:opacity-50"
          >
            Use agent default
          </button>
        ) : (
          !controls?.fast && (
            <p className="text-[11px] leading-4 text-tertiary">
              {discovery.loading
                ? 'Loading options…'
                : controls
                  ? 'Not supported by this model'
                  : 'Options unavailable'}
            </p>
          )
        )}
      </div>
    </div>
  )
}
