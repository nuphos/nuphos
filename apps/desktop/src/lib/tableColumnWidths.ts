/**
 * Column width layout for `components/Table`.
 *
 * Three inputs feed the final width of a column, in descending priority:
 *   1. a width the user dragged (persisted per table),
 *   2. a width measured from the rendered header + visible cells,
 *   3. the `width` the call site declared, else FALLBACK_WIDTH.
 *
 * Whatever the container has left over after that is handed to the columns
 * that opted into growing, so a table always fills its pane instead of
 * parking the slack in the trailing spacer column.
 */

export type ColumnWidthSpec = {
  key: string
  /** Declared fixed starting width. Opts the column out of auto-measurement. */
  width?: number
  /** Floor for user resizing and for the measured width. */
  minWidth?: number
  /** Ceiling for the measured width and for growing. */
  maxWidth?: number
  /**
   * Share of the leftover container width this column absorbs. When no column
   * declares one, the first column without a declared `width` implicitly grows
   * — a table that sized every column by hand keeps its exact layout.
   */
  grow?: number
  /** Pinned to an edge of the pane — see `stickyLayout`. */
  pin?: 'left' | 'right'
}

/** Width of a column that declared nothing and could not be measured. */
export const FALLBACK_WIDTH = 160
/** Bounds applied to *measured* widths only; a declared `width` is taken as-is. */
export const MIN_MEASURED_WIDTH = 64
export const MAX_MEASURED_WIDTH = 480
/**
 * A tighter pair of ceilings for an auto-fitted *pinned* column.
 *
 * Fitting takes the widest row, which is the wrong statistic for a column the
 * reader can never scroll past: one long name would tax every other row at
 * every scroll position. The pane share keeps a narrow window usable, the
 * absolute cap stops a wide monitor from handing the whole ceiling back, and
 * the column's own `minWidth` floors both.
 */
export const MAX_PINNED_WIDTH = 320
export const PINNED_PANE_SHARE = 0.3
/**
 * Floor for a dragged width. A pinned column never grows or re-fits, so one
 * dragged to nothing would stay invisible — along with the handle needed to
 * drag it back. Narrower than MIN_MEASURED_WIDTH so a deliberately tight
 * column (a 48px actions column) can still be tightened further.
 */
export const MIN_RESIZE_WIDTH = 32

/** Floor a width the user dragged, so a column can never be lost entirely. */
export function clampResized(spec: ColumnWidthSpec, width: number): number {
  return Math.max(spec.minWidth ?? MIN_RESIZE_WIDTH, MIN_RESIZE_WIDTH, width)
}

/**
 * Read persisted widths back, keeping only entries that name a column this
 * table renders and that describe a usable width. Anything else — a hand-edited
 * or half-written localStorage blob, a zero from an older build — is dropped
 * rather than pinning a column at a width it can never escape.
 */
export function sanitizePersistedWidths(
  specs: ColumnWidthSpec[],
  saved: unknown,
): Record<string, number> {
  const out: Record<string, number> = {}

  if (typeof saved !== 'object' || saved === null) return out
  const raw = saved as Record<string, unknown>

  for (const spec of specs) {
    const w = raw[spec.key]

    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue
    out[spec.key] = clampResized(spec, Math.round(w))
  }

  return out
}

/**
 * What to write back. Entries for columns this table does not currently render
 * pass through untouched — a table with conditional columns must not delete the
 * widths of the columns that happen to be hidden right now.
 */
export function mergeForStorage(
  stored: unknown,
  userWidths: Readonly<Record<string, number>>,
  renderedKeys: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {}

  if (typeof stored === 'object' && stored !== null) {
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value
    }
  }
  for (const key of renderedKeys) {
    const w = userWidths[key]

    if (w == null) delete out[key]
    else out[key] = w
  }

  return out
}

export function clampMeasured(spec: ColumnWidthSpec, measured: number): number {
  const min = Math.max(spec.minWidth ?? MIN_MEASURED_WIDTH, 0)
  const max = Math.max(min, spec.maxWidth ?? MAX_MEASURED_WIDTH)

  return Math.min(max, Math.max(min, Math.round(measured)))
}

/**
 * Which columns absorb leftover width, and in what proportion. An explicit
 * `grow` anywhere in the table switches off the implicit rule entirely, so a
 * call site that names its flexible columns gets exactly what it asked for.
 */
export function effectiveGrow(specs: ColumnWidthSpec[]): number[] {
  // Never a pinned column, however it was asked for: slack has to land
  // somewhere the reader can scroll past, and a pinned grower would spend the
  // whole pane on a column that then refuses to move.
  const flexible = (s: ColumnWidthSpec) => !s.pin

  if (specs.some((s) => s.grow != null)) {
    return specs.map((s) => (flexible(s) ? Math.max(0, s.grow ?? 0) : 0))
  }
  const implicit = specs.findIndex((s) => s.width == null && flexible(s))

  return specs.map((_, i) => (i === implicit ? 1 : 0))
}

/**
 * The ceiling a fitted pinned column is held to, given the pane it lives in.
 * Its own `minWidth` still wins — a column too narrow to read is worse than a
 * wide one.
 */
export function pinnedCeiling(spec: ColumnWidthSpec, available: number): number {
  const share = available > 0 ? Math.floor(available * PINNED_PANE_SHARE) : MAX_PINNED_WIDTH

  return Math.max(spec.minWidth ?? 0, Math.min(MAX_PINNED_WIDTH, share))
}

export function resolveBaseWidths(
  specs: ColumnWidthSpec[],
  userWidths: Readonly<Record<string, number>>,
  measured: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {}

  for (const spec of specs) {
    const chosen = userWidths[spec.key] ?? measured[spec.key] ?? spec.width ?? FALLBACK_WIDTH

    out[spec.key] = Math.max(spec.minWidth ?? 0, Math.round(chosen))
  }

  return out
}

/**
 * Hand `available - Σ base` to the growable columns, pro-rata. A column that
 * hits its `maxWidth` drops out and returns its share to the pool, so the
 * remaining growers keep filling. Columns the user has resized are pinned:
 * an explicit drag outranks the layout's opinion.
 */
export function distributeSlack(
  specs: ColumnWidthSpec[],
  base: Readonly<Record<string, number>>,
  available: number,
  pinned: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const out: Record<string, number> = { ...base }

  if (!Number.isFinite(available) || available <= 0) return out

  const grows = effectiveGrow(specs)
  const pool = specs
    .map((spec, i) => ({ spec, grow: grows[i] }))
    .filter(({ spec, grow }) => grow > 0 && !pinned.has(spec.key))

  if (pool.length === 0) return out

  // Whole pixels throughout: a table whose columns sum to a fraction over its
  // pane gets a 1px horizontal scrollbar, which reads as a rendering bug.
  const room = Math.floor(available)

  // Each pass either hands out all the slack or saturates at least one column,
  // so the column count bounds the loop.
  for (let pass = 0; pass <= specs.length; pass++) {
    const used = specs.reduce((sum, s) => sum + out[s.key], 0)
    const slack = room - used

    if (slack < 1) break
    const candidates = pool.filter(({ spec }) => out[spec.key] < (spec.maxWidth ?? Infinity))

    if (candidates.length === 0) break
    const totalGrow = candidates.reduce((sum, c) => sum + c.grow, 0)
    let handed = 0

    candidates.forEach(({ spec, grow }, i) => {
      // The last candidate takes the rounding remainder, so the passes stay
      // exact and a saturated column's share is not silently dropped.
      const share =
        i === candidates.length - 1 ? slack - handed : Math.floor((slack * grow) / totalGrow)

      handed += share
      const headroom = (spec.maxWidth ?? Infinity) - out[spec.key]

      out[spec.key] += Math.min(share, headroom)
    })
  }

  return out
}

export function layoutColumnWidths(
  specs: ColumnWidthSpec[],
  options: {
    userWidths?: Readonly<Record<string, number>>
    measured?: Readonly<Record<string, number>>
    /** Container width the columns share; 0/unknown skips growing. */
    available?: number
  } = {},
): Record<string, number> {
  const userWidths = options.userWidths ?? {}
  const available = options.available ?? 0
  const base = resolveBaseWidths(specs, userWidths, options.measured ?? {})

  // Only what the fit guessed is capped. A declared `width` and a dragged one
  // are both explicit decisions about a column the caller can see.
  for (const spec of specs) {
    if (!spec.pin || spec.width != null || userWidths[spec.key] != null) continue
    base[spec.key] = Math.min(base[spec.key], pinnedCeiling(spec, available))
  }

  return distributeSlack(specs, base, available, new Set(Object.keys(userWidths)))
}
