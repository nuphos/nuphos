import { tool } from 'ai'
import { z } from 'zod'

import { labelField } from './labeling'

export function createChartTool() {
  return tool({
    description:
      'Render a data visualization (area, bar, or line chart) inline in the chat. ' +
      'Use this whenever the user asks to see trends, breakdowns, comparisons, distributions, ' +
      'or any numeric data that would be clearer as a chart than a table or prose. ' +
      'After calling this tool, briefly explain what the chart shows — do not restate the raw numbers. ' +
      'Output of this tool is just an echo of the input; the chart is drawn by the frontend.',
    inputSchema: z
      .object({
        label: labelField,
        type: z
          .enum(['area', 'bar', 'line'])
          .describe(
            'Chart type. Use area for cumulative / over-time series, bar for categorical comparisons, line for trends.',
          ),
        title: z.string().min(1).max(120).describe('Chart title shown above the chart.'),
        description: z
          .string()
          .max(200)
          .optional()
          .describe('Optional one-line subtitle, e.g. the time range or filter.'),
        xKey: z
          .string()
          .min(1)
          .describe(
            'Name of the field in `data` to use as the x-axis (e.g. "date", "month", "region").',
          ),
        series: z
          .array(
            z.object({
              key: z
                .string()
                .min(1)
                .describe("Field name in each data row that holds this series' numeric value."),
              label: z
                .string()
                .optional()
                .describe('Display name for this series in the legend / tooltip.'),
            }),
          )
          .min(1)
          .max(6)
          .describe('One entry per series to plot. For a single-series chart, pass one entry.'),
        data: z
          .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
          .min(1)
          .max(200)
          .describe(
            'Array of row objects. Each row must contain the xKey field plus a numeric value for every series.key. ' +
              'Example: [{ date: "2026-01", users: 120 }, { date: "2026-02", users: 180 }].',
          ),
      })
      .superRefine((value, ctx) => {
        const seriesKeys = value.series.map((s) => s.key)
        const seen = new Set<string>()

        for (const key of seriesKeys) {
          if (seen.has(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['series'],
              message: `Duplicate series key: ${key}`,
            })
          }
          seen.add(key)
        }
        value.data.forEach((row, i) => {
          // `in` would match inherited prototype properties (e.g. "toString"),
          // so use own-property check.
          if (!Object.prototype.hasOwnProperty.call(row, value.xKey)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['data', i, value.xKey],
              message: `Row is missing xKey "${value.xKey}"`,
            })
          }
          for (const key of seriesKeys) {
            const cell = row[key]

            if (typeof cell !== 'number' && cell !== null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['data', i, key],
                message: `Series "${key}" must be a number or null`,
              })
            }
          }
        })
      }),
    execute: async (input) => {
      const { label: _label, ...payload } = input

      return payload
    },
  })
}
