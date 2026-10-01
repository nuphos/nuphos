import { z } from 'zod'

import type { DashboardPanelOutput, DashboardPanelKind } from '@/models'

// The validated output contract a panel script must emit. The `chart` variant
// mirrors the desktop ChartPayload (apps/desktop/src/components/agent/Chart.tsx)
// verbatim so the renderer's tryParseChartPayload accepts a snapshot's output
// unchanged. Scripts print exactly one line `<SENTINEL><json>` to stdout; the
// exec service extracts and validates it against `panelOutputSchema`.

export const OUTPUT_SENTINEL = '__PANEL_OUTPUT__'
export const ERROR_SENTINEL = '__PANEL_ERROR__'

const cell = z.union([z.string(), z.number(), z.null()])
const seriesSpec = z.object({
  key: z.string().min(1).max(120),
  label: z.string().max(160).optional(),
})

// Plain ZodObject (no effects) so it can be a discriminatedUnion member; the
// per-row invariant is enforced on the union via superRefine below.
const chartOutput = z.object({
  kind: z.literal('chart'),
  type: z.enum(['area', 'bar', 'line']),
  title: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  xKey: z.string().min(1).max(120),
  series: z.array(seriesSpec).min(1).max(12),
  data: z.array(z.record(cell)).min(1).max(1_000),
  // Stack the series (whole-and-parts, e.g. total split by account) instead of
  // overlaying independent fills. Use for by-account / by-service breakdowns.
  stacked: z.boolean().optional(),
})

const scalarOutput = z.object({
  kind: z.literal('scalar'),
  title: z.string().min(1).max(200),
  value: z.number().finite(),
  unit: z.enum(['usd', 'count', 'percent']).default('usd'),
  deltaPct: z.number().finite().optional(),
  sublabel: z.string().max(200).optional(),
})

const tableOutput = z.object({
  kind: z.literal('table'),
  title: z.string().min(1).max(200),
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        label: z.string().max(160).optional(),
        numeric: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
  rows: z.array(z.record(cell)).max(1_000),
})

export const panelOutputSchema = z
  .discriminatedUnion('kind', [chartOutput, scalarOutput, tableOutput])
  .superRefine((v, ctx) => {
    if (v.kind !== 'chart') return
    // Every row must carry xKey and number|null for each declared series —
    // mirrors Chart.tsx isValidPayload so Recharts never flattens undefined→0.
    const keys = v.series.map((s) => s.key)

    v.data.forEach((row, i) => {
      if (!(v.xKey in row)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['data', i],
          message: `row missing xKey "${v.xKey}"`,
        })
      }
      for (const k of keys) {
        const val = row[k]

        if (typeof val !== 'number' && val !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['data', i, k],
            message: `series "${k}" must be number|null`,
          })
        }
      }
    })
  })

// Compile-time guard: the inferred schema type must stay assignable to the
// hand-written model type (and vice versa) so the two never silently drift.
type Inferred = z.infer<typeof panelOutputSchema>
const _assertModelMatchesSchema: DashboardPanelOutput = {} as Inferred
const _assertSchemaMatchesModel: Inferred = {} as DashboardPanelOutput

/** A completed snapshot's output.kind must match the panel's declared kind, so
 *  an alert's metric extractor is well-defined. */
export function outputMatchesKind(output: Inferred, kind: DashboardPanelKind): boolean {
  return output.kind === kind
}
