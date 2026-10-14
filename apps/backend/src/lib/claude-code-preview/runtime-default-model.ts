import type { RuntimeModelCatalog } from './runtime-models'

/**
 * Claude Code offers "Default (recommended)" and names the model it stands for
 * in the description. Show that model instead, as the desktop's local probe
 * does, so a new chat on any runtime names the model it will run.
 */
export function resolveDefaultModel(catalog: RuntimeModelCatalog): RuntimeModelCatalog {
  const inherited = catalog.models.find((model) => model.id === 'default')
  const resolved = catalog.models.find(
    (model) =>
      model.id !== 'default' &&
      Boolean(inherited?.description) &&
      (model.name === inherited?.description || model.id === inherited?.description),
  )

  if (!resolved) return catalog

  return {
    ...catalog,
    models: catalog.models.filter((model) => model !== inherited),
    ...(catalog.controls?.modelId === 'default'
      ? { controls: { ...catalog.controls, modelId: resolved.id } }
      : {}),
  }
}
