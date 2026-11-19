import type { RuntimeDefaults } from './openab-acp-session'
import type { RuntimeModelCatalog } from './runtime-models'
import type { SessionConfigOption, SessionConfigState } from './session-config-options'

/** The runtime's own choices as session options; a pick it still offers is the current value. */
export function catalogSessionConfig(
  catalog: RuntimeModelCatalog,
  chosen: RuntimeDefaults,
): SessionConfigOption[] {
  const controls = catalog.controls
  const option = (
    id: keyof RuntimeDefaults,
    name: string,
    choices: { value: string; name: string; description?: string }[],
    fallback: string,
  ): SessionConfigOption => ({
    id,
    name,
    kind: id,
    currentValue: choices.some((choice) => choice.value === chosen[id]) ? chosen[id]! : fallback,
    options: choices.map(({ value, name, description }) => ({ value, name, description })),
  })

  const settings = [
    ...(controls?.effort.length
      ? [option('effort', 'Effort', controls.effort, controls.defaultEffort ?? 'default')]
      : []),
    ...(controls?.fast.length
      ? [option('fast', 'Fast', controls.fast, controls.defaultFast ?? 'off')]
      : []),
  ]

  // Grok Build lists its reasoning effort but no models: its effort is still a
  // setting this conversation picks, and the pick applies when the session starts.
  if (!catalog.models.length) return settings

  return [
    option(
      'model',
      'Model',
      catalog.models.map(({ id, name, description }) => ({ value: id, name, description })),
      controls?.modelId ?? 'default',
    ),
    ...settings,
  ]
}

/**
 * The runtime's choices, and the picks it still offers. A model it no longer
 * lists (re-login, update) is dropped and the list read again without it.
 */
export async function offeredSessionConfig(
  catalogFor: (model?: string) => Promise<RuntimeModelCatalog>,
  pick: RuntimeDefaults,
  confirmedOnly = false,
): Promise<{ options: SessionConfigOption[]; kept: RuntimeDefaults }> {
  let catalog = pick.model ? await catalogFor(pick.model).catch(() => {}) : undefined

  if (!catalog?.models.length) catalog = await catalogFor()
  const offered = catalogSessionConfig(catalog, pick)
  const options = confirmedOnly
    ? offered.map((option) => {
        // Claude Code's "default" model is listed as the model it stands for.
        const value =
          option.kind === 'model' && pick.model === 'default'
            ? option.currentValue
            : pick[option.kind]
        const confirmed =
          value !== undefined && option.options.some((choice) => choice.value === value)

        // An unconfirmed setting stays offered, without claiming a value.
        return { ...option, currentValue: confirmed ? value : '' }
      })
    : offered
  const kept = Object.fromEntries(
    Object.entries(pick).filter(
      ([id, value]) => options.find((option) => option.id === id)?.currentValue === value,
    ),
  ) as RuntimeDefaults

  return { options, kept }
}

/**
 * A model the runtime's list lacks but the session itself last reported running
 * (a Task started on its parent's model, on a computer whose list is behind) is
 * named from that report instead of left blank.
 */
export function namedModel(
  state: SessionConfigState,
  attachment: { sessionConfig?: SessionConfigOption[] },
): SessionConfigState {
  const running = attachment.sessionConfig?.find(
    (option) => option.kind === 'model' && option.currentValue,
  )

  if (!running) return state

  return {
    ...state,
    options: state.options.map((option) =>
      option.kind === 'model' && !option.currentValue ? running : option,
    ),
  }
}
