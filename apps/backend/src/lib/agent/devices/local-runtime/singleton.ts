/**
 * One instance per process, surviving `bun --hot` module reloads: a tunnel
 * opened before a reload keeps writing presence and serving streams, so the
 * reloaded modules must see the same bus and presence store.
 */
export function processSingleton<T>(name: string, create: () => T): T {
  const key = Symbol.for(`nuphos.localRuntime.${name}`)
  const scope = globalThis as Record<symbol, unknown>

  scope[key] ??= create()

  return scope[key] as T
}
