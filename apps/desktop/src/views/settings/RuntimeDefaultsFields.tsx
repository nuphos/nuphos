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
  const effort = controls?.effort.filter((option) => option.value !== 'default') ?? []
  const inheritedEffort = value.effort ?? controls?.defaultEffort
  const selectedEffort = inheritedEffort === 'default' ? undefined : inheritedEffort
  const missingEffort =
    value.effort &&
    value.effort !== 'default' &&
    !effort.some((option) => option.value === value.effort)

  if (discovery.loading && !controls) {
    return (
      <div
        aria-label="Loading conversation defaults"
        aria-busy="true"
        className="grid grid-cols-3 gap-3"
      >
        {['Model', 'Effort', 'Fast mode'].map((label) => (
          <div key={label} className="space-y-2">
            <span className="block text-xs text-secondary">{label}</span>
            <div className="h-9 animate-pulse rounded-md bg-zGray-800/60 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }}
    >
      <RuntimeModelSelect
        {...discovery}
        value={value.model}
        onChange={(model) => onChange({ model })}
        disabled={disabled}
      />
      <div className="min-w-0 space-y-2">
        <span className="block text-xs text-secondary">Effort</span>
        <AppSelect
          ariaLabel="Effort"
          placeholder="Choose effort"
          value={selectedEffort ? `effort:${selectedEffort}` : ''}
          options={[
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
          disabled={disabled || !controls || (!effort.length && !value.effort)}
          onValueChange={(selection) => onChange({ ...value, effort: selection.slice(7) })}
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
            {(value.fast ?? controls?.defaultFast) === 'on' ? 'On' : 'Off'}
          </span>
        </div>
        {!controls?.fast && (
          <p className="text-[11px] leading-4 text-tertiary">
            {discovery.loading
              ? 'Loading options…'
              : controls
                ? 'Not supported by this model'
                : 'Options unavailable'}
          </p>
        )}
      </div>
    </div>
  )
}
