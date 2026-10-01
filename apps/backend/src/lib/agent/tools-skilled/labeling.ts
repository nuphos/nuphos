import { tool } from 'ai'
import { z } from 'zod'

const labelDescription = [
  'Short user-facing description (5–12 words) of what THIS specific tool call does.',
  "CRITICAL: write the label in the SAME LANGUAGE as the user's MOST RECENT message.",
  'When detecting that language, ignore file paths, URLs, XML/HTML tags, command output, skill content, system prompt content, and any other embedded context — only the user-authored message text counts.',
  'If the latest user message is in English, the label MUST be in English even if earlier turns were in another language.',
  'If the latest user message is in a non-English language (e.g. Chinese, Japanese, Korean, Spanish), write the label in that same language.',
  'Examples (English): "Loading kubectl skill", "Fetching nodes from prod cluster".',
  'The frontend renders this verbatim next to the tool indicator.',
].join(' ')

export const labelField = z.string().min(1).max(160).describe(labelDescription)

/**
 * Wrap an AI SDK tool to require a `label` field in its input. The label is
 * stripped before the underlying tool's execute() runs — it exists purely so
 * the frontend can render a per-tool-call description.
 */
export function withLabel<T extends Record<string, z.ZodTypeAny>>(
  original: any,
  paramShape: T,
  options?: {
    onExecuteError?: (err: unknown, input: any) => unknown
    // Inspect the (label-stripped) input before running the real tool. Return a
    // result to short-circuit (skip the underlying execute); return undefined to
    // proceed. Used to reject degenerate inputs (e.g. an empty bash command) with
    // a recoverable result instead of running them.
    onBeforeExecute?: (input: any) => unknown
    // Transform the result after a successful execute (e.g. persist oversized
    // bash output to the sandbox). Must not throw for recoverable conditions —
    // fail open and return the original result instead.
    onAfterExecute?: (result: any, input: any) => any
  },
) {
  return tool({
    description: original.description,
    inputSchema: z.object({ label: labelField, ...paramShape }) as any,
    execute: async (input: any, opts: any) => {
      const { label: _label, ...rest } = input
      const shortCircuit = options?.onBeforeExecute?.(rest)

      if (shortCircuit !== undefined) return shortCircuit
      try {
        const result = await original.execute(rest, opts)

        return options?.onAfterExecute ? await options.onAfterExecute(result, rest) : result
      } catch (err) {
        if (options?.onExecuteError) return options.onExecuteError(err, rest)
        throw err
      }
    },
  }) as any
}

export function clientToolWithLabel<T extends Record<string, z.ZodTypeAny>>(
  description: string,
  paramShape: T,
) {
  return tool({
    description,
    inputSchema: z.object({ label: labelField, ...paramShape }) as any,
  }) as any
}
