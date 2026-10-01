import { afterAll, beforeEach } from 'bun:test'

// One process-global `mock.module` registration per module, with the
// implementation chosen at call time.
//
// The alternative — every suite registering its own factory — does not work:
// the registry is process-wide and consumers bind the module's exports when
// they first import it, so exactly one suite's factory ends up live and
// the others' recorders silently answer nobody. Which suite wins depends on the
// runner's file order, so the same commit passed on one machine and failed on
// another. Here there is nothing to win: the single registration reads
// `installed` on every call.
const installed = new Map<string, Record<string, unknown>>()

/**
 * `class X {}` is `typeof === 'function'`, but an arrow wrapper around one has
 * no [[Construct]] — `new X()` throws and statics/prototype are lost — so
 * classes pass through like value exports.
 */
function isClass(value: unknown): boolean {
  return /^class[\s{]/.test(Function.prototype.toString.call(value))
}

/**
 * Wraps every plain-function export so it resolves through `installed` at call
 * time. Non-function exports — and class exports — pass through untouched.
 *
 * Must be called before the matching `mock.module`, so the real implementations
 * are captured off the namespace rather than off the stand-in — reading them
 * back later would resolve to these wrappers and recurse forever.
 */
export function buildDouble<M extends object>(spec: string, actual: M): M {
  const stand: Record<string, unknown> = { ...(actual as Record<string, unknown>) }

  for (const [name, real] of Object.entries(actual)) {
    if (typeof real !== 'function' || isClass(real)) continue
    stand[name] = (...args: unknown[]) => {
      const override = installed.get(spec)?.[name]

      return typeof override === 'function'
        ? (override as (...a: unknown[]) => unknown)(...args)
        : (real as (...a: unknown[]) => unknown)(...args)
    }
  }

  return stand as M
}

/**
 * Builds the per-file installer for a doubled module. The returned function is
 * called at suite scope with the overrides that file needs; it registers both
 * `beforeEach` and `afterAll` itself, so a suite cannot leak its recorders into
 * the next file by forgetting to clean up.
 *
 * It returns an installer for the occasional per-test override — call it with
 * no arguments to drop back to the file's base.
 */
/**
 * Only plain-function exports can be overridden — `buildDouble` dispatches by
 * wrapping functions, and a value export cannot be intercepted at all: a
 * consumer reads it once when it binds the import, so a getter on the stand-in
 * is never consulted again (probed directly: the override reads back as
 * undefined). Class exports are excluded too — see `isClass`. Naming either
 * here is a compile error rather than an override that silently does nothing.
 *
 * Overrides keep the real parameter types — so a stub cannot drift from the
 * signature it stands in for — but may return anything. Test fixtures are
 * routinely narrower than the production DTO (a plan without its approval
 * bookkeeping, a membership without its team), and forcing them to be complete
 * is a different change from removing the mock collisions.
 */
export type Overrides<M> = {
  [
    K in keyof M as M[K] extends abstract new (...args: never[]) => unknown
      ? never
      : M[K] extends (...args: never[]) => unknown
        ? K
        : never
  ]?: M[K] extends (...args: infer A) => unknown ? (...args: A) => unknown : never
}

export function makeInstaller<M extends object>(spec: string) {
  return (base: Overrides<M>): ((extra?: Overrides<M>) => void) => {
    const install = (extra: Overrides<M> = {}) =>
      installed.set(spec, { ...base, ...extra } as Record<string, unknown>)

    install()
    beforeEach(() => install())
    afterAll(() => installed.delete(spec))

    return install
  }
}
