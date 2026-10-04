import type { RuntimeDefaults, RuntimeModelCatalog } from '../../types/runtime'

export function normalizeRuntimeDefaults(value: RuntimeDefaults): RuntimeDefaults {
  return {
    ...(value.model?.trim() ? { model: value.model.trim() } : {}),
    ...(value.fast ? { fast: value.fast } : {}),
    ...(value.effort?.trim() ? { effort: value.effort.trim() } : {}),
  }
}

export function runtimeDefaultsError(
  value: RuntimeDefaults,
  controls: RuntimeModelCatalog['controls'],
) {
  if ((value.effort || value.fast) && !controls) return 'Load this model’s options before saving.'
  if (value.effort && controls && !controls.effort.some((option) => option.value === value.effort))
    return 'Choose a supported effort.'
  if (value.fast && controls && !controls.fast) return 'Fast mode is unavailable for this model.'

  return null
}

/** Resolve the initial selection from the model's actual supported controls. */
export function resolvedRuntimeDefaults(
  value: RuntimeDefaults,
  controls: RuntimeModelCatalog['controls'],
): RuntimeDefaults {
  if (!controls) return value
  const efforts = controls.effort.filter((option) => option.value !== 'default')
  const effort =
    value.effort && value.effort !== 'default'
      ? value.effort
      : (efforts.find((option) => option.value === controls.defaultEffort)?.value ??
        efforts.find((option) => option.value === 'medium')?.value ??
        efforts[0]?.value)

  return normalizeRuntimeDefaults({
    ...value,
    model: value.model && value.model !== 'default' ? value.model : controls.modelId,
    effort,
    fast: value.fast ?? (controls.fast ? (controls.defaultFast ?? 'off') : undefined),
  })
}
