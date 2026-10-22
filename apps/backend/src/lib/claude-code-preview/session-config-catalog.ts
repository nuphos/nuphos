import type { RuntimeDefaults } from './openab-acp-session'
import type { RuntimeModelCatalog } from './runtime-models'
import type { SessionConfigOption } from './session-config-options'
import type { ConversationPreviewAttachment } from '@/lib/agent/db/shared'

/**
 * A session busy with its first turn has never confirmed its settings, and the
 * runtime does not answer until the turn ends. It runs the settings it started
 * with, so show those rather than nothing.
 */
export async function unansweredSessionConfig(
  attachment: Pick<ConversationPreviewAttachment, 'sessionConfig' | 'runtimeDefaults'>,
  catalogFor: ((model?: string) => Promise<RuntimeModelCatalog>) | undefined,
): Promise<SessionConfigOption[]> {
  if (attachment.sessionConfig?.length || !catalogFor) return attachment.sessionConfig ?? []
  const started = await offeredSessionConfig(catalogFor, attachment.runtimeDefaults ?? {}).catch(
    () => undefined,
  )

  return started?.options ?? []
}

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

  if (!catalog.models.length) return []

  return [
    option(
      'model',
      'Model',
      catalog.models.map(({ id, name, description }) => ({ value: id, name, description })),
      controls?.modelId ?? 'default',
    ),
    ...(controls?.effort.length
      ? [option('effort', 'Effort', controls.effort, controls.defaultEffort ?? 'default')]
      : []),
    ...(controls?.fast
      ? [
          option(
            'fast',
            'Fast',
            [
              { value: 'on', name: 'On' },
              { value: 'off', name: 'Off' },
            ],
            controls.defaultFast ?? 'off',
          ),
        ]
      : []),
  ]
}

/**
 * The runtime's choices, and the picks it still offers. A model it no longer
 * lists (re-login, update) is dropped and the list read again without it.
 */
export async function offeredSessionConfig(
  catalogFor: (model?: string) => Promise<RuntimeModelCatalog>,
  pick: RuntimeDefaults,
): Promise<{ options: SessionConfigOption[]; kept: RuntimeDefaults }> {
  let catalog = pick.model ? await catalogFor(pick.model).catch(() => undefined) : undefined

  if (!catalog?.models.length) catalog = await catalogFor()
  const options = catalogSessionConfig(catalog, pick)
  const kept = Object.fromEntries(
    Object.entries(pick).filter(
      ([id, value]) => options.find((option) => option.id === id)?.currentValue === value,
    ),
  ) as RuntimeDefaults

  return { options, kept }
}
