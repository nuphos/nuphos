import { AppSelect } from '../../components/ui/select'

import type { RuntimeModelCatalog } from '../../types/runtime'

export function RuntimeModelSelect({
  value,
  onChange,
  disabled,
  catalog,
  models,
  loading,
  error,
  retry,
}: {
  value?: string
  onChange: (value: string | undefined) => void
  disabled: boolean
  catalog: RuntimeModelCatalog | null
  models: RuntimeModelCatalog['models']
  loading: boolean
  error?: string | null
  retry: () => void
}) {
  const missing = value && !models.some((model) => model.id === value)
  const options = [
    { value: 'default', label: 'Agent default' },
    ...models.map((model) => ({
      value: `model:${model.id}`,
      label: model.name,
      description: model.description,
    })),
    ...(missing
      ? [
          {
            value: `model:${value}`,
            label: value,
            description: catalog?.models.length ? 'Saved model · no longer listed' : 'Saved model',
          },
        ]
      : []),
  ]

  return (
    <div className="col-span-2 min-w-0 space-y-2 sm:col-span-1">
      <span className="block text-xs text-secondary">Default model</span>
      <AppSelect
        ariaLabel="Default model"
        value={value ? `model:${value}` : 'default'}
        options={options}
        onValueChange={(selection) =>
          onChange(selection === 'default' ? undefined : selection.slice(6))
        }
        disabled={disabled}
        triggerClassName="text-xs"
      />
      {loading && (
        <p role="status" className="text-[11px] text-tertiary">
          Loading models…
        </p>
      )}
      {!loading && error && (
        <div className="space-y-1 text-[11px] leading-4 text-tertiary" role="status">
          <p>{error}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => retry()}
            className="text-secondary underline underline-offset-2 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && !error && missing && catalog && (
        <p role="status" className="text-[11px] leading-4 text-tertiary">
          Saved model is no longer listed. Choose another model or use the agent default.
        </p>
      )}
    </div>
  )
}
