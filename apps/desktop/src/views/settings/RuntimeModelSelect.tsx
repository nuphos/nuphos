import { isDefaultModel } from '../../lib/modelChoices'
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
  const selectedModel = value && !isDefaultModel(value) ? value : catalog?.controls?.modelId
  const missing = value && !isDefaultModel(value) && !models.some((model) => model.id === value)
  const options = [
    ...models.map((model) => ({
      value: `model:${model.id}`,
      label: model.name,
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
    <div className="min-w-0 space-y-2">
      <span className="block text-xs text-secondary">Model</span>
      <AppSelect
        ariaLabel="Model"
        value={selectedModel ? `model:${selectedModel}` : ''}
        options={options}
        onValueChange={(selection) => onChange(selection.slice(6))}
        disabled={disabled || !options.length}
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
          Saved model is no longer listed. Choose another model.
        </p>
      )}
    </div>
  )
}
