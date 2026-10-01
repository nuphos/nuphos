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
  if ((value.effort || value.fast) && !controls)
    return 'Load this model’s options before saving, or use the agent defaults.'
  if (value.effort && controls && !controls.effort.some((option) => option.value === value.effort))
    return 'Choose a supported effort or use the agent default.'
  if (value.fast && controls && !controls.fast)
    return 'Fast mode is unavailable for this model. Use the agent default.'

  return null
}
